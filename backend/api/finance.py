from datetime import date
from decimal import Decimal
from typing import List, Optional

from django.db import transaction
from django.db.models.deletion import ProtectedError, RestrictedError
from django.http import HttpRequest
from ninja import Router, Schema
from ninja import Status
from ninja.errors import HttpError

from backend.accounting.services import create_operational_journal_safe
from backend.core.access import (
    ROLE_FINANCE,
    ROLE_OPERATOR,
    ROLE_SUPER_ADMIN,
    require_any_capability,
    require_capability,
    tenant_session_auth,
)
from backend.core.services import model_snapshot, record_audit
from backend.finance.models import (
    SupplierInvoice,
    Asset,
    CostAllocation,
    CustomerInvoice,
    DepreciationSchedule,
    PaymentRequest,
    PettyCashTransaction,
)
from backend.finance.services import (
    create_supplier_invoice_from_purchase_order,
    pay_supplier_invoice,
    allocate_customer_payment,
    create_customer_invoice,
    defer_payment_request,
    dispose_asset,
    generate_depreciation_schedule,
    pay_payment_request,
    petty_cash_balance,
    post_depreciation,
    submit_payment_request,
)
from backend.accounting.models import AccountingPeriod
from backend.masterdata.models import BankAccount, CostCategory, Operator
from backend.inventory.models import PurchaseOrder
from backend.production.models import ProductionCost, ProductionOrder

router = Router(tags=["Finance"], auth=tenant_session_auth)


class PettyCashPayload(Schema):
    date: date
    type: str
    amount: Decimal
    category: Optional[str] = None
    description: Optional[str] = None
    pic: Optional[str] = None
    account_id: Optional[str] = None
    funding_mode: str = "company_fund"
    proof_id: Optional[str] = None


class PettyCashResponse(Schema):
    id: str
    date: date
    type: str
    amount: str
    category: Optional[str]
    description: Optional[str]
    status: str
    pic: Optional[str]


class DetailResponse(Schema):
    detail: str


class CostAllocationItemPayload(Schema):
    production_order_id: str
    amount: Decimal


class CostAllocationPayload(Schema):
    period_id: str
    category_id: str
    amount: Decimal
    allocation_basis: str = "manual"
    allocations: List[CostAllocationItemPayload]
    reason: str


class CostAllocationResponse(Schema):
    id: str
    period_id: str
    period_name: str
    category_id: str
    category_name: str
    amount: str
    allocation_basis: str
    allocations: list
    reason: str


def _cost_allocation_response(item: CostAllocation) -> dict:
    return {
        "id": str(item.id),
        "period_id": str(item.period_id),
        "period_name": item.period.name,
        "category_id": str(item.category_id),
        "category_name": item.category.name,
        "amount": str(item.amount),
        "allocation_basis": item.allocation_basis,
        "allocations": item.allocations,
        "reason": item.reason,
    }


@router.post("/petty-cash", response=PettyCashResponse)
def record_petty_cash(request: HttpRequest, payload: PettyCashPayload):
    context = require_any_capability(
        request,
        {"finance.petty_cash.create", "finance.petty_cash.dapur_draft"},
    )
    tenant_id = context.tenant_id
    if payload.type not in PettyCashTransaction.Type.values or payload.amount <= 0:
        raise HttpError(422, "Jenis atau jumlah transaksi kas kecil tidak valid")
    if request.tenant_context.role == ROLE_OPERATOR:
        is_kitchen_staff = Operator.objects.filter(
            tenant_id=tenant_id,
            user=request.user,
            operator_type=Operator.OperatorType.DAPUR,
            status=Operator.OperatorStatus.INTERNAL,
            is_active=True,
        ).exists()
        if not is_kitchen_staff or payload.type != PettyCashTransaction.Type.OUT:
            raise HttpError(
                403, "Hanya petugas dapur yang dapat mencatat draft pengeluaran"
            )
    if (
        payload.account_id
        and not BankAccount.objects.filter(
            tenant_id=tenant_id, id=payload.account_id, is_active=True
        ).exists()
    ):
        raise HttpError(404, "Rekening kas kecil tidak ditemukan")
    can_post = context.role in {ROLE_SUPER_ADMIN, ROLE_FINANCE}
    tx = PettyCashTransaction.objects.create(
        tenant_id=tenant_id,
        date=payload.date,
        type=payload.type,
        amount=payload.amount,
        category=payload.category,
        description=payload.description,
        pic=payload.pic,
        status=(
            PettyCashTransaction.Status.POSTED
            if can_post
            else PettyCashTransaction.Status.DRAFT
        ),
        account_id=payload.account_id,
        funding_mode=payload.funding_mode,
        proof_id=payload.proof_id,
        created_by=request.user,
        verified_by=request.user if can_post else None,
    )
    if can_post:
        create_operational_journal_safe(
            tenant=request.tenant_context.tenant,
            event_type=f"petty_cash.{tx.type}",
            amount=tx.amount,
            journal_date=tx.date,
            source_type="PettyCashTransaction",
            source_id=str(tx.id),
            description=tx.description or f"Kas kecil {tx.get_type_display()}",
            final=True,
            user=request.user,
        )
    record_audit(
        tenant=request.tenant_context.tenant,
        user=request.user,
        action="petty_cash_recorded",
        resource_type="PettyCashTransaction",
        resource_id=tx.id,
        after=model_snapshot(tx),
    )
    return {
        "id": str(tx.id),
        "date": tx.date,
        "type": tx.type,
        "amount": str(tx.amount),
        "category": tx.category,
        "description": tx.description,
        "status": tx.status,
        "pic": tx.pic,
    }


@router.post("/petty-cash/{transaction_id}/verify", response=PettyCashResponse)
def verify_petty_cash(request: HttpRequest, transaction_id: str):
    context = require_capability(request, "finance.petty_cash.verify")
    tenant_id = context.tenant_id
    tx = PettyCashTransaction.objects.filter(
        tenant_id=tenant_id, id=transaction_id, status=PettyCashTransaction.Status.DRAFT
    ).first()
    if tx is None:
        raise HttpError(404, "Draft kas kecil tidak ditemukan")
    before = model_snapshot(tx)
    tx.status = PettyCashTransaction.Status.VERIFIED
    tx.verified_by = request.user
    tx.save(update_fields=["status", "verified_by", "updated_at"])
    record_audit(
        tenant=request.tenant_context.tenant,
        user=request.user,
        action="petty_cash_verified",
        resource_type="PettyCashTransaction",
        resource_id=tx.id,
        before=before,
        after=model_snapshot(tx),
    )
    return tx


@router.get("/petty-cash", response=List[PettyCashResponse])
def list_petty_cash(request: HttpRequest):
    context = require_any_capability(
        request,
        {"finance.petty_cash.read", "finance.petty_cash.dapur_draft"},
    )
    tenant_id = context.tenant_id
    txs = PettyCashTransaction.objects.filter(tenant_id=tenant_id).order_by(
        "-date", "-created_at"
    )
    if request.tenant_context.role == ROLE_OPERATOR:
        txs = txs.filter(created_by=request.user)
    return [
        {
            "id": str(tx.id),
            "date": tx.date,
            "type": tx.type,
            "amount": str(tx.amount),
            "category": tx.category,
            "description": tx.description,
            "status": tx.status,
            "pic": tx.pic,
        }
        for tx in txs
    ]


@router.get("/cost-allocations", response=List[CostAllocationResponse])
def list_cost_allocations(request: HttpRequest):
    context = require_capability(request, "finance.cost_allocations.read")
    rows = (
        CostAllocation.objects.select_related("period", "category")
        .filter(tenant=context.tenant)
        .order_by("-created_at")
    )
    return [_cost_allocation_response(item) for item in rows]


@router.post("/cost-allocations", response=CostAllocationResponse)
def create_cost_allocation(request: HttpRequest, payload: CostAllocationPayload):
    context = require_capability(request, "finance.cost_allocations.create")
    if payload.amount <= 0:
        raise HttpError(422, "Nilai alokasi harus lebih besar dari nol")
    if not payload.allocations:
        raise HttpError(422, "Minimal satu SPK tujuan wajib dipilih")
    allocated_total = sum(item.amount for item in payload.allocations)
    if allocated_total != payload.amount:
        raise HttpError(422, "Total alokasi harus sama dengan nilai biaya")

    period = AccountingPeriod.objects.filter(
        tenant=context.tenant, id=payload.period_id
    ).first()
    category = CostCategory.objects.filter(
        tenant=context.tenant, id=payload.category_id
    ).first()
    if period is None or category is None:
        raise HttpError(404, "Periode atau kategori biaya tidak ditemukan")

    order_ids = [item.production_order_id for item in payload.allocations]
    orders = {
        str(order.id): order
        for order in ProductionOrder.objects.filter(
            tenant=context.tenant, id__in=order_ids
        )
    }
    if len(orders) != len(set(order_ids)):
        raise HttpError(404, "Salah satu SPK tujuan tidak ditemukan")
    closed_orders = [
        order.order_number
        for order in orders.values()
        if order.status
        in {ProductionOrder.Status.COMPLETED, ProductionOrder.Status.CLOSED}
    ]
    if closed_orders:
        raise HttpError(
            422,
            f"SPK selesai tidak dapat menerima alokasi biaya: {', '.join(closed_orders)}",
        )

    allocation_rows = [
        {
            "production_order_id": item.production_order_id,
            "order_number": orders[item.production_order_id].order_number,
            "amount": str(item.amount),
        }
        for item in payload.allocations
    ]
    with transaction.atomic():
        allocation = CostAllocation.objects.create(
            tenant=context.tenant,
            period=period,
            category=category,
            amount=payload.amount,
            allocation_basis=payload.allocation_basis or category.allocation_basis,
            allocations=allocation_rows,
            reason=payload.reason,
            created_by=request.user,
        )
        for item in payload.allocations:
            order = orders[item.production_order_id]
            ProductionCost.objects.create(
                tenant=context.tenant,
                production_order=order,
                component=category.name,
                source_type="CostAllocation",
                source_id=str(allocation.id),
                amount=item.amount,
                allocation_basis=allocation.allocation_basis,
            )
        record_audit(
            tenant=context.tenant,
            user=request.user,
            action="cost_allocation_created",
            resource_type="CostAllocation",
            resource_id=allocation.id,
            after=model_snapshot(allocation),
            reason=payload.reason,
        )
    return _cost_allocation_response(
        CostAllocation.objects.select_related("period", "category").get(
            pk=allocation.pk
        )
    )


# Asset endpoint mapping
class AssetPayload(Schema):
    name: str
    category: str
    acquisition_value: Decimal
    acquisition_date: date
    useful_life_months: int
    depreciation_start_date: date
    location: Optional[str] = None


class ReasonPayload(Schema):
    reason: str


class AssetResponse(Schema):
    id: str
    name: str
    category: str
    acquisition_value: str
    acquisition_date: date
    useful_life_months: int
    depreciation_start_date: date
    status: str
    location: Optional[str]


def _asset_response(asset: Asset) -> dict:
    return {
        "id": str(asset.id),
        "name": asset.name,
        "category": asset.category,
        "acquisition_value": str(asset.acquisition_value),
        "acquisition_date": asset.acquisition_date,
        "useful_life_months": asset.useful_life_months,
        "depreciation_start_date": asset.depreciation_start_date,
        "status": asset.status,
        "location": asset.location,
    }


@router.post("/assets", response=AssetResponse)
def register_asset(request: HttpRequest, payload: AssetPayload):
    context = require_capability(request, "finance.assets.create")
    tenant_id = context.tenant_id
    asset = Asset.objects.create(
        tenant_id=tenant_id,
        name=payload.name,
        category=payload.category,
        acquisition_value=payload.acquisition_value,
        acquisition_date=payload.acquisition_date,
        useful_life_months=payload.useful_life_months,
        depreciation_start_date=payload.depreciation_start_date,
        location=payload.location or "",
        status=Asset.Status.ACTIVE,
    )
    generate_depreciation_schedule(asset)
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="asset_created",
        resource_type="Asset",
        resource_id=asset.id,
        after=model_snapshot(asset),
    )
    return _asset_response(asset)


@router.get("/assets", response=List[AssetResponse])
def list_assets(request: HttpRequest):
    context = require_capability(request, "finance.assets.read")
    tenant_id = context.tenant_id
    assets = Asset.objects.filter(tenant_id=tenant_id).order_by("-created_at")
    return [_asset_response(asset) for asset in assets]


@router.patch("/assets/{asset_id}", response=AssetResponse)
def update_asset(request: HttpRequest, asset_id: str, payload: AssetPayload):
    context = require_capability(request, "finance.assets.update")
    asset = Asset.objects.filter(tenant=context.tenant, id=asset_id).first()
    if asset is None:
        raise HttpError(404, "Aset tidak ditemukan")
    if asset.status in {Asset.Status.SOLD, Asset.Status.RETIRED}:
        raise HttpError(422, "Aset yang sudah dilepas tidak dapat diedit")
    before = model_snapshot(asset)
    for attr, value in payload.dict().items():
        setattr(asset, attr, value or "" if attr == "location" else value)
    asset.save()
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="asset_updated",
        resource_type="Asset",
        resource_id=asset.id,
        before=before,
        after=model_snapshot(asset),
    )
    return _asset_response(asset)


@router.post("/assets/{asset_id}/activate", response=AssetResponse)
def activate_asset(request: HttpRequest, asset_id: str, payload: ReasonPayload):
    context = require_capability(request, "finance.assets.activate")
    asset = Asset.objects.filter(tenant=context.tenant, id=asset_id).first()
    if asset is None:
        raise HttpError(404, "Aset tidak ditemukan")
    before = model_snapshot(asset)
    asset.status = Asset.Status.ACTIVE
    asset.save(update_fields=["status", "updated_at"])
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="asset_activated",
        resource_type="Asset",
        resource_id=asset.id,
        before=before,
        after=model_snapshot(asset),
        reason=payload.reason,
    )
    return _asset_response(asset)


@router.post("/assets/{asset_id}/deactivate", response=AssetResponse)
def deactivate_asset(request: HttpRequest, asset_id: str, payload: ReasonPayload):
    context = require_capability(request, "finance.assets.deactivate")
    asset = Asset.objects.filter(tenant=context.tenant, id=asset_id).first()
    if asset is None:
        raise HttpError(404, "Aset tidak ditemukan")
    before = model_snapshot(asset)
    asset.status = Asset.Status.INACTIVE
    asset.save(update_fields=["status", "updated_at"])
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="asset_deactivated",
        resource_type="Asset",
        resource_id=asset.id,
        before=before,
        after=model_snapshot(asset),
        reason=payload.reason,
    )
    return _asset_response(asset)


@router.delete(
    "/assets/{asset_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_asset(request: HttpRequest, asset_id: str):
    context = require_capability(request, "finance.assets.delete")
    asset = Asset.objects.filter(tenant=context.tenant, id=asset_id).first()
    if asset is None:
        raise HttpError(404, "Aset tidak ditemukan")
    if asset.depreciations.filter(is_posted=True).exists():
        return Status(
            409,
            {
                "detail": "Aset sudah memiliki penyusutan posted dan tidak dapat dihapus."
            },
        )
    before = model_snapshot(asset)
    resource_id = str(asset.id)
    try:
        asset.delete()
    except (ProtectedError, RestrictedError):
        return Status(409, {"detail": "Aset masih digunakan dan tidak dapat dihapus."})
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="asset_deleted",
        resource_type="Asset",
        resource_id=resource_id,
        before=before,
    )
    return {"detail": "Aset berhasil dihapus."}


class AssetDisposalPayload(Schema):
    disposal_date: date
    reason: str
    disposal_value: Decimal = Decimal("0")
    proof_id: Optional[str] = None


@router.post("/assets/{asset_id}/dispose", response=AssetResponse)
def dispose_registered_asset(
    request: HttpRequest, asset_id: str, payload: AssetDisposalPayload
):
    context = require_capability(request, "finance.assets.dispose")
    tenant_id = context.tenant_id
    asset = Asset.objects.filter(tenant_id=tenant_id, id=asset_id).first()
    if asset is None:
        raise HttpError(404, "Aset tidak ditemukan")
    try:
        return dispose_asset(
            asset,
            disposal_date=payload.disposal_date,
            reason=payload.reason,
            disposal_value=payload.disposal_value,
            proof_id=payload.proof_id,
            user=request.user,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/depreciations/{schedule_id}/post")
def post_asset_depreciation(request: HttpRequest, schedule_id: str):
    context = require_capability(request, "finance.assets.depreciation.post")
    tenant_id = context.tenant_id
    schedule = DepreciationSchedule.objects.filter(
        tenant_id=tenant_id, id=schedule_id
    ).first()
    if schedule is None:
        raise HttpError(404, "Jadwal penyusutan tidak ditemukan")
    try:
        posted = post_depreciation(schedule, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {"id": str(posted.id), "is_posted": posted.is_posted}


@router.get("/petty-cash/balance")
def get_petty_cash_balance(request: HttpRequest, account_id: Optional[str] = None):
    context = require_capability(request, "finance.petty_cash.balance")
    tenant = context.tenant
    account = None
    if account_id:
        account = BankAccount.objects.filter(tenant=tenant, id=account_id).first()
        if account is None:
            raise HttpError(404, "Rekening kas kecil tidak ditemukan")
    return {"balance": str(petty_cash_balance(tenant, account))}


class PaymentRequestPayload(Schema):
    request_type: str
    source_type: str
    source_id: str
    amount: Decimal
    recipient: str
    due_date: Optional[date] = None
    proof_id: Optional[str] = None


class PaymentRequestResponse(Schema):
    id: str
    request_number: str
    request_type: str
    amount: str
    recipient: str
    due_date: Optional[date]
    status: str


@router.get("/payment-requests", response=List[PaymentRequestResponse])
def list_payment_requests(request: HttpRequest):
    context = require_capability(request, "finance.payment_requests.read")
    tenant_id = context.tenant_id
    return [
        {
            "id": str(pr.id),
            "request_number": pr.request_number,
            "request_type": pr.request_type,
            "amount": str(pr.amount),
            "recipient": pr.recipient,
            "due_date": pr.due_date,
            "status": pr.status,
        }
        for pr in PaymentRequest.objects.filter(tenant_id=tenant_id).order_by(
            "-created_at"
        )
    ]


@router.post("/payment-requests", response=PaymentRequestResponse)
def create_payment_request(request: HttpRequest, payload: PaymentRequestPayload):
    context = require_capability(request, "finance.payment_requests.create")
    tenant = context.tenant
    try:
        return submit_payment_request(
            tenant=tenant,
            user=request.user,
            request_type=payload.request_type,
            source_type=payload.source_type,
            source_id=payload.source_id,
            amount=payload.amount,
            recipient=payload.recipient,
            due_date=payload.due_date,
            proof_id=payload.proof_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class DeferPaymentPayload(Schema):
    reason: str


@router.post("/payment-requests/{request_id}/defer", response=PaymentRequestResponse)
def defer_payment(request: HttpRequest, request_id: str, payload: DeferPaymentPayload):
    context = require_capability(request, "finance.payment_requests.defer")
    tenant_id = context.tenant_id
    payment_request = PaymentRequest.objects.filter(
        tenant_id=tenant_id, id=request_id
    ).first()
    if payment_request is None:
        raise HttpError(404, "Permintaan pembayaran tidak ditemukan")
    try:
        return defer_payment_request(
            payment_request, user=request.user, reason=payload.reason
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class PayRequestPayload(Schema):
    account_id: str
    payment_date: date
    payment_method: str
    proof_id: str


@router.post("/payment-requests/{request_id}/pay", response=PaymentRequestResponse)
def pay_request(request: HttpRequest, request_id: str, payload: PayRequestPayload):
    context = require_capability(request, "finance.payment_requests.pay")
    tenant_id = context.tenant_id
    payment_request = PaymentRequest.objects.filter(
        tenant_id=tenant_id, id=request_id
    ).first()
    account = BankAccount.objects.filter(
        tenant_id=tenant_id, id=payload.account_id, is_active=True
    ).first()
    if payment_request is None or account is None:
        raise HttpError(404, "Permintaan atau rekening tidak ditemukan")
    try:
        return pay_payment_request(
            payment_request,
            user=request.user,
            account=account,
            payment_date=payload.payment_date,
            payment_method=payload.payment_method,
            proof_id=payload.proof_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class CustomerInvoicePayload(Schema):
    delivery_ids: List[str]
    due_date: Optional[date] = None


@router.get("/customer-invoices")
def list_customer_invoices(request: HttpRequest):
    context = require_capability(request, "finance.customer_invoices.read")
    tenant_id = context.tenant_id
    return list(
        CustomerInvoice.objects.filter(tenant_id=tenant_id)
        .select_related("customer", "sales_po")
        .order_by("-date")
        .values(
            "id",
            "invoice_number",
            "date",
            "due_date",
            "customer__name",
            "sales_po__po_number",
            "total_amount",
            "amount_paid",
            "status",
        )
    )


@router.post("/customer-invoices")
def issue_customer_invoice(request: HttpRequest, payload: CustomerInvoicePayload):
    context = require_capability(request, "finance.customer_invoices.create")
    tenant = context.tenant
    try:
        invoice = create_customer_invoice(
            tenant=tenant,
            delivery_ids=payload.delivery_ids,
            due_date=payload.due_date,
            user=request.user,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {
        "id": str(invoice.id),
        "invoice_number": invoice.invoice_number,
        "total_amount": str(invoice.total_amount),
        "status": invoice.status,
    }


class PaymentAllocationPayload(Schema):
    customer_id: str
    amount: Decimal
    account_id: str
    allocations: List[dict]
    reference: str = ""
    proof_id: Optional[str] = None


@router.post("/customer-payments")
def receive_customer_payment(request: HttpRequest, payload: PaymentAllocationPayload):
    context = require_capability(request, "finance.customer_payments.create")
    tenant = context.tenant
    account = BankAccount.objects.filter(
        tenant=tenant, id=payload.account_id, is_active=True
    ).first()
    if account is None:
        raise HttpError(404, "Rekening tidak ditemukan")
    try:
        payment = allocate_customer_payment(
            tenant=tenant,
            user=request.user,
            customer_id=payload.customer_id,
            amount=payload.amount,
            account=account,
            allocations=payload.allocations,
            reference=payload.reference,
            proof_id=payload.proof_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {"id": str(payment.id), "amount": str(payment.amount)}


class SupplierInvoiceLinePayload(Schema):
    purchase_order_line_id: str
    quantity: Decimal
    unit_price: Decimal


class SupplierInvoicePayload(Schema):
    purchase_order_id: str
    invoice_number: str
    date: date
    due_date: Optional[date] = None
    lines: list[SupplierInvoiceLinePayload]


class SupplierInvoiceResponse(Schema):
    id: str
    invoice_number: str
    date: date
    due_date: Optional[date]
    total_amount: str
    amount_paid: str
    status: str


@router.post("/supplier-invoices", response=SupplierInvoiceResponse)
def create_supplier_invoice(request: HttpRequest, payload: SupplierInvoicePayload):
    context = require_capability(request, "finance.supplier_invoices.create")
    tenant_id = context.tenant_id
    po = PurchaseOrder.objects.filter(
        id=payload.purchase_order_id, tenant_id=tenant_id
    ).first()
    if not po:
        raise HttpError(404, "Purchase Order tidak ditemukan")

    try:
        inv = create_supplier_invoice_from_purchase_order(
            po=po,
            user=request.user,
            invoice_number=payload.invoice_number,
            date=payload.date,
            due_date=payload.due_date,
            lines=[
                {
                    "purchase_order_line_id": line.purchase_order_line_id,
                    "quantity": line.quantity,
                    "unit_price": line.unit_price,
                }
                for line in payload.lines
            ],
        )
        return {
            "id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "date": inv.date,
            "due_date": inv.due_date,
            "total_amount": str(inv.total_amount),
            "amount_paid": str(inv.amount_paid),
            "status": inv.status,
        }
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.get("/supplier-invoices", response=list[SupplierInvoiceResponse])
def list_supplier_invoices(request: HttpRequest):
    context = require_capability(request, "finance.supplier_invoices.read")
    tenant_id = context.tenant_id
    qs = SupplierInvoice.objects.filter(tenant_id=tenant_id).order_by(
        "-date", "-created_at"
    )
    return [
        {
            "id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "date": inv.date,
            "due_date": inv.due_date,
            "total_amount": str(inv.total_amount),
            "amount_paid": str(inv.amount_paid),
            "status": inv.status,
        }
        for inv in qs
    ]


class PaySupplierInvoicePayload(Schema):
    account_id: str
    payment_date: date
    amount: Decimal
    reference: str = ""
    proof_id: Optional[str] = None


@router.post("/supplier-invoices/{invoice_id}/pay")
def pay_invoice(
    request: HttpRequest, invoice_id: str, payload: PaySupplierInvoicePayload
):
    context = require_capability(request, "finance.supplier_invoices.pay")
    tenant_id = context.tenant_id
    invoice = SupplierInvoice.objects.filter(id=invoice_id, tenant_id=tenant_id).first()
    if not invoice:
        raise HttpError(404, "Supplier Invoice tidak ditemukan")

    account = BankAccount.objects.filter(
        id=payload.account_id, tenant_id=tenant_id
    ).first()
    if not account:
        raise HttpError(404, "Rekening Bank tidak ditemukan")

    try:
        pay = pay_supplier_invoice(
            invoice=invoice,
            user=request.user,
            account=account,
            payment_date=payload.payment_date,
            amount=payload.amount,
            reference=payload.reference,
            proof_id=payload.proof_id,
        )
        return {"status": "ok", "payment_id": str(pay.id)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
