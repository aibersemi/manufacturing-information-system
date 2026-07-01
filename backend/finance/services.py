"""Workflow pembayaran, piutang, kas kecil, invoice, dan aset."""

from __future__ import annotations

from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from backend.accounting.services import (
    create_operational_journal,
    create_operational_journal_safe,
    period_for_date,
)
from backend.core.models import Membership, Tenant, User
from backend.core.notifications import create_role_notifications
from backend.core.services import next_document_number, record_audit, model_snapshot
from backend.finance.models import (
    SupplierPayment,
    SupplierInvoice,
    SupplierInvoiceLine,
    AdvanceAllocation,
    Asset,
    CustomerAdvance,
    CustomerInvoice,
    CustomerPayment,
    CustomerPaymentAllocation,
    DepreciationSchedule,
    InvoiceDelivery,
    PaymentRequest,
    PettyCashTransaction,
)
from backend.masterdata.models import BankAccount
from backend.sales.models import Delivery
from backend.inventory.models import PurchaseOrder, PurchaseOrderLine

MONEY_QUANTUM = Decimal("0.01")


def _add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return value.replace(
        day=min(value.day, monthrange(year, month)[1]), year=year, month=month
    )


def aging_bucket(due_date: date | None, *, as_of: date | None = None) -> str:
    if due_date is None:
        return "belum_jatuh_tempo"
    current = as_of or timezone.localdate()
    days = (current - due_date).days
    if days <= 0:
        return "belum_jatuh_tempo"
    if days <= 30:
        return "1_30"
    if days <= 60:
        return "31_60"
    if days <= 90:
        return "61_90"
    return "lebih_90"


@transaction.atomic
def submit_payment_request(
    *,
    tenant: Tenant,
    user: User,
    request_type: str,
    source_type: str,
    source_id: str,
    amount: Decimal,
    recipient: str,
    due_date: date | None = None,
    proof_id: str | None = None,
) -> PaymentRequest:
    if amount <= 0:
        raise ValueError("Nilai permintaan pembayaran harus lebih besar dari nol.")
    payment_request = PaymentRequest.objects.create(
        tenant=tenant,
        request_number=next_document_number(tenant, "PAYREQ"),
        request_type=request_type,
        source_type=source_type,
        source_id=source_id,
        amount=amount,
        recipient=recipient,
        due_date=due_date,
        status=PaymentRequest.Status.WAITING,
        requested_by=user,
        proof_id=proof_id,
    )
    record_audit(
        tenant=tenant,
        user=user,
        action="payment_request_submitted",
        resource_type="PaymentRequest",
        resource_id=payment_request.id,
        after={"number": payment_request.request_number, "amount": amount},
    )
    create_role_notifications(
        tenant=tenant,
        event_type="payment_request",
        title=f"Permintaan pembayaran {payment_request.request_number}",
        message=f"{recipient}: Rp {amount}",
        safe_path=f"/finance/payment-requests/{payment_request.id}",
        deduplication_key=f"payment-request:{payment_request.id}",
        roles={Membership.Role.FINANCE, Membership.Role.KEPALA_KONVEKSI},
        telegram=True,
    )
    return payment_request


@transaction.atomic
def defer_payment_request(
    payment_request: PaymentRequest, *, user: User, reason: str
) -> PaymentRequest:
    payment_request = PaymentRequest.objects.select_for_update().get(
        pk=payment_request.pk
    )
    if payment_request.status != PaymentRequest.Status.WAITING:
        raise ValueError("Permintaan tidak sedang menunggu Finance.")
    if not reason:
        raise ValueError("Penundaan wajib memiliki alasan.")
    payment_request.status = PaymentRequest.Status.DEFERRED
    payment_request.defer_reason = reason
    payment_request.save(update_fields=["status", "defer_reason", "updated_at"])
    record_audit(
        tenant=payment_request.tenant,
        user=user,
        action="payment_request_deferred",
        resource_type="PaymentRequest",
        resource_id=payment_request.id,
        reason=reason,
    )
    return payment_request


@transaction.atomic
def pay_payment_request(
    payment_request: PaymentRequest,
    *,
    user: User,
    account: BankAccount,
    payment_date: date,
    payment_method: str,
    proof_id: str,
) -> PaymentRequest:
    payment_request = PaymentRequest.objects.select_for_update().get(
        pk=payment_request.pk
    )
    if payment_request.status not in {
        PaymentRequest.Status.WAITING,
        PaymentRequest.Status.DEFERRED,
    }:
        raise ValueError("Permintaan pembayaran tidak dapat dibayar pada status ini.")
    if account.tenant_id != payment_request.tenant_id:
        raise ValueError("Rekening pembayaran berasal dari konveksi lain.")
    if not proof_id:
        raise ValueError("Bukti pembayaran wajib dilampirkan.")
    payment_request.account = account
    payment_request.payment_date = payment_date
    payment_request.payment_method = payment_method
    payment_request.proof_id = proof_id
    payment_request.status = PaymentRequest.Status.PAID
    payment_request.save()
    create_operational_journal(
        tenant=payment_request.tenant,
        event_type=f"payment.{payment_request.request_type}",
        amount=payment_request.amount,
        journal_date=payment_date,
        source_type="PaymentRequest",
        source_id=str(payment_request.id),
        description=f"Pembayaran {payment_request.request_number}",
        final=True,
        user=user,
    )
    record_audit(
        tenant=payment_request.tenant,
        user=user,
        action="payment_request_paid",
        resource_type="PaymentRequest",
        resource_id=payment_request.id,
        after={
            "account": account.id,
            "amount": payment_request.amount,
            "date": payment_date,
        },
    )

    if payment_request.source_type == "OperatorWorkLogBatch":
        work_log_ids = payment_request.source_id.split(",")
        from backend.production.models import OperatorWorkLog
        from backend.production.models import JobPacket

        OperatorWorkLog.objects.filter(id__in=work_log_ids).update(is_paid=True)
        # Update job packet status
        packet_ids = OperatorWorkLog.objects.filter(id__in=work_log_ids).values_list(
            "progress__job_packet_id", flat=True
        )
        JobPacket.objects.filter(id__in=packet_ids).update(status=JobPacket.Status.PAID)

    return payment_request


def petty_cash_balance(tenant: Tenant, account: BankAccount | None = None) -> Decimal:
    transactions = PettyCashTransaction.objects.filter(
        tenant=tenant, status=PettyCashTransaction.Status.POSTED
    )
    if account:
        transactions = transactions.filter(account=account)
    incoming = transactions.filter(type=PettyCashTransaction.Type.IN).aggregate(
        total=Sum("amount")
    )["total"] or Decimal("0")
    outgoing = transactions.filter(type=PettyCashTransaction.Type.OUT).aggregate(
        total=Sum("amount")
    )["total"] or Decimal("0")
    return incoming - outgoing


@transaction.atomic
def create_customer_invoice(
    *,
    tenant: Tenant,
    delivery_ids: list[str],
    due_date: date | None,
    user: User,
) -> CustomerInvoice:
    deliveries = list(
        Delivery.objects.select_for_update()
        .filter(tenant=tenant, id__in=delivery_ids)
        .select_related("sales_po__customer")
        .prefetch_related("lines__sales_po_line")
    )
    if len(deliveries) != len(set(delivery_ids)) or not deliveries:
        raise ValueError("Pengiriman tidak ditemukan pada konveksi aktif.")
    po_ids = {delivery.sales_po_id for delivery in deliveries}
    customer_ids = {delivery.sales_po.customer_id for delivery in deliveries}
    if len(po_ids) != 1 or len(customer_ids) != 1:
        raise ValueError(
            "Invoice gabungan harus berasal dari PO dan pelanggan yang sama."
        )
    if InvoiceDelivery.objects.filter(delivery__in=deliveries).exists():
        raise ValueError("Salah satu pengiriman sudah pernah ditagihkan.")

    total = sum(
        line.quantity * line.sales_po_line.unit_price
        for delivery in deliveries
        for line in delivery.lines.all()
    )
    sales_po = deliveries[0].sales_po
    invoice = CustomerInvoice.objects.create(
        tenant=tenant,
        sales_po=sales_po,
        customer=sales_po.customer,
        invoice_number=next_document_number(tenant, "INV"),
        date=timezone.localdate(),
        due_date=due_date,
        total_amount=total,
        status=CustomerInvoice.Status.UNPAID,
        issued_at=timezone.now(),
    )
    for delivery in deliveries:
        delivery_amount = sum(
            line.quantity * line.sales_po_line.unit_price
            for line in delivery.lines.all()
        )
        InvoiceDelivery.objects.create(
            tenant=tenant, invoice=invoice, delivery=delivery, amount=delivery_amount
        )
    create_operational_journal_safe(
        tenant=tenant,
        event_type="invoice.issued",
        amount=total,
        journal_date=invoice.date,
        source_type="CustomerInvoice",
        source_id=str(invoice.id),
        description=f"Penerbitan invoice {invoice.invoice_number}",
        final=True,
        user=user,
    )
    record_audit(
        tenant=tenant,
        user=user,
        action="customer_invoice_issued",
        resource_type="CustomerInvoice",
        resource_id=invoice.id,
        after={
            "number": invoice.invoice_number,
            "deliveries": delivery_ids,
            "total": total,
        },
    )
    return invoice


@transaction.atomic
def allocate_customer_payment(
    *,
    tenant: Tenant,
    user: User,
    customer_id: str,
    amount: Decimal,
    account: BankAccount,
    allocations: list[dict],
    reference: str,
    proof_id: str | None,
) -> CustomerPayment:
    if amount <= 0:
        raise ValueError("Pembayaran harus lebih besar dari nol.")
    allocation_total = sum(
        (Decimal(str(item["amount"])) for item in allocations), Decimal("0")
    )
    if allocation_total != amount:
        raise ValueError("Total alokasi harus sama dengan pembayaran.")
    payment = CustomerPayment.objects.create(
        tenant=tenant,
        customer_id=customer_id,
        date=timezone.localdate(),
        amount=amount,
        payment_method="transfer",
        account=account,
        reference=reference,
        proof_id=proof_id,
    )
    for item in allocations:
        invoice = (
            CustomerInvoice.objects.select_for_update()
            .filter(tenant=tenant, pk=item["invoice_id"], customer_id=customer_id)
            .first()
        )
        if invoice is None:
            raise ValueError("Invoice alokasi tidak ditemukan.")
        allocated = Decimal(str(item["amount"]))
        outstanding = (
            invoice.total_amount + invoice.adjustment_total - invoice.amount_paid
        )
        if allocated <= 0 or allocated > outstanding:
            raise ValueError("Alokasi pembayaran melebihi saldo invoice.")
        CustomerPaymentAllocation.objects.create(
            tenant=tenant, payment=payment, invoice=invoice, amount=allocated
        )
        invoice.amount_paid += allocated
        invoice.status = (
            CustomerInvoice.Status.PAID
            if invoice.amount_paid == invoice.total_amount + invoice.adjustment_total
            else CustomerInvoice.Status.PARTIAL
        )
        invoice.save(update_fields=["amount_paid", "status", "updated_at"])
    create_operational_journal(
        tenant=tenant,
        event_type="customer_payment.received",
        amount=amount,
        journal_date=payment.date,
        source_type="CustomerPayment",
        source_id=str(payment.id),
        description=f"Pembayaran pelanggan {reference}",
        final=True,
        user=user,
    )
    return payment


@transaction.atomic
def allocate_customer_advance(
    advance: CustomerAdvance,
    *,
    invoice: CustomerInvoice,
    amount: Decimal,
    user: User,
) -> AdvanceAllocation:
    advance = CustomerAdvance.objects.select_for_update().get(pk=advance.pk)
    invoice = CustomerInvoice.objects.select_for_update().get(pk=invoice.pk)
    if (
        advance.tenant_id != invoice.tenant_id
        or advance.sales_po_id != invoice.sales_po_id
    ):
        raise ValueError("Uang muka dan invoice harus berasal dari PO yang sama.")
    available = advance.amount - advance.allocated_amount
    outstanding = invoice.total_amount + invoice.adjustment_total - invoice.amount_paid
    if amount <= 0 or amount > available or amount > outstanding:
        raise ValueError("Alokasi uang muka melebihi saldo yang tersedia.")
    allocation = AdvanceAllocation.objects.create(
        tenant=advance.tenant, advance=advance, invoice=invoice, amount=amount
    )
    advance.allocated_amount += amount
    advance.save(update_fields=["allocated_amount", "updated_at"])
    invoice.amount_paid += amount
    invoice.status = (
        CustomerInvoice.Status.PAID
        if invoice.amount_paid == invoice.total_amount + invoice.adjustment_total
        else CustomerInvoice.Status.PARTIAL
    )
    invoice.save(update_fields=["amount_paid", "status", "updated_at"])
    record_audit(
        tenant=advance.tenant,
        user=user,
        action="customer_advance_allocated",
        resource_type="CustomerAdvance",
        resource_id=advance.id,
        after={"invoice": invoice.id, "amount": amount},
    )
    return allocation


def generate_depreciation_schedule(asset: Asset) -> list[DepreciationSchedule]:
    if asset.depreciation_method != "straight_line":
        raise ValueError("V1 hanya mendukung penyusutan garis lurus.")
    acquisition_value = Decimal(str(asset.acquisition_value))
    monthly = (acquisition_value / asset.useful_life_months).quantize(Decimal("0.01"))
    schedules = []
    for index in range(asset.useful_life_months):
        schedule_date = _add_months(asset.depreciation_start_date, index)
        amount = (
            acquisition_value - monthly * (asset.useful_life_months - 1)
            if index == asset.useful_life_months - 1
            else monthly
        )
        schedule, _created = DepreciationSchedule.objects.get_or_create(
            tenant=asset.tenant,
            asset=asset,
            date=schedule_date,
            defaults={"amount": amount},
        )
        schedules.append(schedule)
    return schedules


@transaction.atomic
def post_depreciation(
    schedule: DepreciationSchedule, *, user: User
) -> DepreciationSchedule:
    schedule = (
        DepreciationSchedule.objects.select_for_update()
        .select_related("asset__tenant")
        .get(pk=schedule.pk)
    )
    if schedule.is_posted:
        return schedule
    create_operational_journal(
        tenant=schedule.tenant,
        event_type="depreciation.posted",
        amount=schedule.amount,
        journal_date=schedule.date,
        source_type="DepreciationSchedule",
        source_id=str(schedule.id),
        description=f"Penyusutan {schedule.asset.name}",
        final=True,
        user=user,
    )
    schedule.is_posted = True
    schedule.save(update_fields=["is_posted", "updated_at"])
    return schedule


@transaction.atomic
def dispose_asset(
    asset: Asset,
    *,
    disposal_date: date,
    reason: str,
    disposal_value: Decimal,
    proof_id: str | None,
    user: User,
) -> Asset:
    asset = Asset.objects.select_for_update().get(pk=asset.pk)
    if asset.status in {Asset.Status.SOLD, Asset.Status.RETIRED}:
        raise ValueError("Aset sudah pernah dilepas.")
    if not reason:
        raise ValueError("Pelepasan aset wajib memiliki alasan.")
    # Validasi periode dilakukan sebelum status aset berubah.
    period_for_date(asset.tenant, disposal_date)
    asset.status = Asset.Status.SOLD if disposal_value > 0 else Asset.Status.RETIRED
    asset.disposal_date = disposal_date
    asset.disposal_reason = reason
    asset.disposal_value = disposal_value
    asset.disposal_proof_id = proof_id
    asset.save()
    if disposal_value > 0:
        create_operational_journal_safe(
            tenant=asset.tenant,
            event_type="asset.disposal",
            amount=disposal_value,
            journal_date=disposal_date,
            source_type="AssetDisposal",
            source_id=str(asset.id),
            description=f"Pelepasan aset {asset.name}",
            final=True,
            user=user,
        )
    record_audit(
        tenant=asset.tenant,
        user=user,
        action="asset_disposed",
        resource_type="Asset",
        resource_id=asset.id,
        reason=reason,
        after={"date": disposal_date, "value": disposal_value},
    )
    return asset


@transaction.atomic
def create_supplier_invoice_from_purchase_order(
    po: PurchaseOrder,
    *,
    user: User,
    invoice_number: str,
    date,
    due_date=None,
    lines: list[dict],
) -> SupplierInvoice:
    if po.status not in {
        PurchaseOrder.Status.COMPLETED,
        PurchaseOrder.Status.PARTIAL_RECEIPT,
    }:
        raise ValueError("Hanya PO dengan penerimaan material yang dapat ditagihkan.")
    if not lines:
        raise ValueError("Invoice pemasok wajib memiliki minimal satu baris material.")

    po_line_ids = [item["purchase_order_line_id"] for item in lines]
    po_lines = {
        str(line.id): line
        for line in PurchaseOrderLine.objects.select_related("material")
        .select_for_update()
        .filter(tenant=po.tenant, purchase_order=po, id__in=po_line_ids)
    }
    if len(po_lines) != len(set(po_line_ids)):
        raise ValueError("Baris invoice harus berasal dari PO yang dipilih.")

    prepared_lines = []
    total_amount = Decimal("0")
    for item in lines:
        quantity = item["quantity"]
        unit_price = item["unit_price"]
        if quantity <= 0:
            raise ValueError("Kuantitas invoice harus lebih besar dari nol.")
        if unit_price <= 0:
            raise ValueError("Harga satuan invoice harus lebih besar dari nol.")

        po_line = po_lines[str(item["purchase_order_line_id"])]
        if po_line.invoiced_qty + quantity > po_line.received_qty:
            raise ValueError("Kuantitas invoice melebihi jumlah material yang diterima.")

        line_total = (quantity * unit_price).quantize(MONEY_QUANTUM)
        total_amount += line_total
        prepared_lines.append(
            {
                "po_line": po_line,
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": line_total,
            }
        )

    invoice = SupplierInvoice.objects.create(
        tenant=po.tenant,
        purchase_order=po,
        supplier=po.supplier,
        invoice_number=invoice_number,
        date=date,
        due_date=due_date,
        total_amount=total_amount.quantize(MONEY_QUANTUM),
    )

    material_updates = []
    for item in prepared_lines:
        po_line = item["po_line"]
        SupplierInvoiceLine.objects.create(
            tenant=po.tenant,
            invoice=invoice,
            purchase_order_line=po_line,
            quantity=item["quantity"],
            unit_price=item["unit_price"],
            line_total=item["line_total"],
        )

        po_line.invoiced_qty += item["quantity"]
        po_line.save(update_fields=["invoiced_qty", "updated_at"])

        material = po_line.material
        before = model_snapshot(material)
        material.last_purchase_price = item["unit_price"]
        material.save(update_fields=["last_purchase_price", "updated_at"])
        material_updates.append(
            {
                "material_id": str(material.id),
                "material_name": material.name,
                "last_purchase_price": str(material.last_purchase_price),
            }
        )
        record_audit(
            tenant=po.tenant,
            user=user,
            action="material_last_purchase_price_updated",
            resource_type="Material",
            resource_id=material.id,
            before=before,
            after=model_snapshot(material),
        )

    record_audit(
        tenant=po.tenant,
        user=user,
        action="supplier_invoice_created",
        resource_type="SupplierInvoice",
        resource_id=invoice.id,
        after={
            **model_snapshot(invoice),
            "lines": [
                {
                    "purchase_order_line_id": str(item["po_line"].id),
                    "material_id": str(item["po_line"].material_id),
                    "quantity": str(item["quantity"]),
                    "unit_price": str(item["unit_price"]),
                    "line_total": str(item["line_total"]),
                }
                for item in prepared_lines
            ],
            "material_updates": material_updates,
        },
    )
    return invoice


@transaction.atomic
def pay_supplier_invoice(
    invoice: SupplierInvoice,
    *,
    user: User,
    account: BankAccount,
    payment_date,
    amount: Decimal,
    reference: str,
    proof_id: str = None,
):
    if invoice.status == SupplierInvoice.Status.PAID:
        raise ValueError("Invoice sudah lunas.")

    if amount <= 0:
        raise ValueError("Jumlah pembayaran harus lebih besar dari nol.")

    invoice = SupplierInvoice.objects.select_for_update().get(pk=invoice.pk)

    payment = SupplierPayment.objects.create(
        tenant=invoice.tenant,
        invoice=invoice,
        account=account,
        payment_date=payment_date,
        amount=amount,
        reference=reference,
        proof_id=proof_id,
        status="completed",
    )

    invoice.amount_paid += amount
    if invoice.amount_paid >= invoice.total_amount:
        invoice.status = SupplierInvoice.Status.PAID
    else:
        invoice.status = SupplierInvoice.Status.PARTIAL

    invoice.save(update_fields=["amount_paid", "status", "updated_at"])

    create_operational_journal_safe(
        tenant=invoice.tenant,
        event_type="payment.supplier_invoice",
        amount=amount,
        journal_date=payment_date,
        source_type="SupplierPayment",
        source_id=str(payment.id),
        description=f"Pembayaran invoice {invoice.invoice_number}",
        final=True,
        user=user,
    )

    record_audit(
        tenant=invoice.tenant,
        user=user,
        action="supplier_invoice_paid",
        resource_type="SupplierInvoice",
        resource_id=invoice.id,
        after={
            "payment_id": str(payment.id),
            "amount_paid": invoice.amount_paid,
            "status": invoice.status,
        },
    )
    return payment
