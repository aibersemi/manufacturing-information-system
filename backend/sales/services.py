"""Workflow PO, fulfillment, pengiriman, short-close, dan retur."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from backend.accounting.services import create_operational_journal_safe
from backend.core.models import Tenant, User
from backend.core.services import model_snapshot, next_document_number, record_audit
from backend.inventory.models import ProductBatch, ProductLedger
from backend.inventory.services import (
    allocate_product_stock,
    move_product_stock,
    product_category_balance,
)
from backend.sales.models import (
    Delivery,
    DeliveryLine,
    SalesPO,
    SalesPOLine,
    SalesPORevision,
    SalesReturn,
    SalesReturnLine,
)


def fulfillment_recommendation(line: SalesPOLine) -> dict:
    available = 0
    allocated = 0
    for batch in ProductBatch.objects.filter(
        tenant=line.tenant, product_variant=line.product_variant
    ):
        available += product_category_balance(
            line.tenant, batch, ProductLedger.Category.AVAILABLE
        )
        allocated += product_category_balance(
            line.tenant, batch, ProductLedger.Category.ALLOCATED
        )
    outstanding = max(0, line.quantity - line.fulfilled_qty)
    use_stock = min(outstanding, available)
    return {
        "ready_stock": available,
        "allocated_stock": allocated,
        "outstanding": outstanding,
        "recommended_stock": use_stock,
        "recommended_production": outstanding - use_stock,
    }


@transaction.atomic
def revise_sales_po(
    po: SalesPO,
    *,
    user: User,
    reason: str,
    changes: dict,
) -> SalesPO:
    po = SalesPO.objects.select_for_update().prefetch_related("lines").get(pk=po.pk)
    if po.is_locked:
        raise ValueError(
            "PO sudah terkunci; gunakan dokumen koreksi/short-close/retur."
        )
    if not reason:
        raise ValueError("Revisi PO wajib memiliki alasan.")
    before = {
        "po": model_snapshot(po),
        "lines": [model_snapshot(line) for line in po.lines.all()],
    }
    SalesPORevision.objects.create(
        tenant=po.tenant,
        sales_po=po,
        version=po.version,
        snapshot=before,
        reason=reason,
        created_by=user,
    )
    allowed = {"customer_id", "order_date", "due_date", "notes", "fulfillment_strategy"}
    for field, value in changes.items():
        if field in allowed:
            setattr(po, field, value)
    po.version += 1
    po.save()
    record_audit(
        tenant=po.tenant,
        user=user,
        action="sales_po_revised",
        resource_type="SalesPO",
        resource_id=po.id,
        before=before,
        after=model_snapshot(po),
        reason=reason,
    )
    return po


@transaction.atomic
def plan_fulfillment(
    po: SalesPO,
    *,
    strategy: str,
    allocations: list[dict],
    user: User,
) -> SalesPO:
    po = SalesPO.objects.select_for_update().prefetch_related("lines").get(pk=po.pk)
    if po.status not in {SalesPO.Status.CONFIRMED, SalesPO.Status.PLANNED}:
        raise ValueError("PO harus dikonfirmasi sebelum perencanaan fulfillment.")
    if strategy not in SalesPO.FulfillmentStrategy.values:
        raise ValueError("Strategi fulfillment tidak valid.")
    if strategy in {
        SalesPO.FulfillmentStrategy.STOCK,
        SalesPO.FulfillmentStrategy.COMBINED,
    }:
        for item in allocations:
            line = SalesPOLine.objects.get(
                tenant=po.tenant, sales_po=po, pk=item["line_id"]
            )
            batch = ProductBatch.objects.get(
                tenant=po.tenant,
                product_variant=line.product_variant,
                pk=item["batch_id"],
            )
            allocate_product_stock(
                tenant=po.tenant,
                sales_line=line,
                batch=batch,
                quantity=int(item["quantity"]),
                user=user,
                idempotency_key=f"allocation:{po.pk}:{line.pk}:{batch.pk}:{po.version}",
            )
    po.fulfillment_strategy = strategy
    po.status = SalesPO.Status.PLANNED
    po.save(update_fields=["fulfillment_strategy", "status", "updated_at"])
    record_audit(
        tenant=po.tenant,
        user=user,
        action="sales_po_fulfillment_planned",
        resource_type="SalesPO",
        resource_id=po.id,
        after={"strategy": strategy, "allocations": allocations},
    )
    return po


@transaction.atomic
def short_close_sales_po(
    po: SalesPO,
    *,
    user: User,
    reason: str,
    evidence_id: str,
) -> SalesPO:
    po = SalesPO.objects.select_for_update().prefetch_related("lines").get(pk=po.pk)
    if po.status in {SalesPO.Status.COMPLETED, SalesPO.Status.CANCELLED}:
        raise ValueError("PO sudah selesai atau dibatalkan.")
    if not reason or not evidence_id:
        raise ValueError("Short-close wajib memiliki alasan dan bukti persetujuan.")
    if not any(line.fulfilled_qty < line.quantity for line in po.lines.all()):
        raise ValueError("PO tidak memiliki kekurangan yang perlu ditutup.")
    po.status = SalesPO.Status.COMPLETED
    po.short_closed_at = timezone.now()
    po.short_close_reason = reason
    po.short_close_evidence_id = evidence_id
    po.save()
    record_audit(
        tenant=po.tenant,
        user=user,
        action="sales_po_short_closed",
        resource_type="SalesPO",
        resource_id=po.id,
        reason=reason,
        after={"evidence_id": evidence_id},
    )
    return po


@transaction.atomic
def create_delivery(
    *,
    tenant: Tenant,
    sales_po: SalesPO,
    lines: list[dict],
    shipping_cost,
    shipping_payer: str,
    address: str,
    user: User,
) -> Delivery:
    if sales_po.tenant_id != tenant.pk:
        raise ValueError("PO berasal dari konveksi lain.")
    delivery = Delivery.objects.create(
        tenant=tenant,
        sales_po=sales_po,
        delivery_number=next_document_number(tenant, "SJ"),
        date=timezone.localdate(),
        status=Delivery.Status.SHIPPED,
        shipping_cost=shipping_cost,
        shipping_payer=shipping_payer,
        delivery_address=address,
    )
    for item in lines:
        sales_line = SalesPOLine.objects.select_for_update().get(
            tenant=tenant, sales_po=sales_po, pk=item["sales_po_line_id"]
        )
        try:
            batch = ProductBatch.objects.select_for_update().get(
                tenant=tenant,
                product_variant=sales_line.product_variant,
                pk=item.get("batch_id"),
            )
        except ProductBatch.DoesNotExist:
            raise ValueError(
                f"Batch produk untuk varian {sales_line.product_variant.sku} tidak ditemukan."
            )
        quantity = int(item["quantity"])
        allocated_balance = product_category_balance(
            tenant, batch, ProductLedger.Category.ALLOCATED
        )
        source_category = (
            ProductLedger.Category.ALLOCATED
            if allocated_balance >= quantity
            else ProductLedger.Category.AVAILABLE
        )
        move_product_stock(
            tenant=tenant,
            batch=batch,
            transaction_type=ProductLedger.TransactionType.SALES_OUT,
            quantity=quantity,
            from_category=source_category,
            to_category=ProductLedger.Category.IN_TRANSIT,
            reference_document=delivery.delivery_number,
            idempotency_key=f"delivery:{delivery.pk}:{sales_line.pk}:{batch.pk}",
            user=user,
        )
        DeliveryLine.objects.create(
            tenant=tenant,
            delivery=delivery,
            sales_po_line=sales_line,
            product_batch=batch,
            quantity=quantity,
        )
        sales_line.fulfilled_qty += quantity
        if sales_line.fulfilled_qty > sales_line.quantity:
            raise ValueError("Pengiriman melebihi kuantitas PO.")
        sales_line.save(update_fields=["fulfilled_qty", "updated_at"])
    sales_po.status = (
        SalesPO.Status.COMPLETED
        if all(line.fulfilled_qty >= line.quantity for line in sales_po.lines.all())
        else SalesPO.Status.PARTIAL
    )
    sales_po.save(update_fields=["status", "updated_at"])
    record_audit(
        tenant=tenant,
        user=user,
        action="delivery_shipped",
        resource_type="Delivery",
        resource_id=delivery.id,
        after={"number": delivery.delivery_number, "lines": lines},
    )
    return delivery


@transaction.atomic
def close_delivery(
    delivery: Delivery,
    *,
    receiver_name: str,
    received_time,
    user: User,
    proof_id: str | None = None,
) -> Delivery:
    delivery = (
        Delivery.objects.select_for_update()
        .prefetch_related("lines")
        .get(pk=delivery.pk)
    )
    if not receiver_name or received_time is None:
        raise ValueError("Nama penerima dan waktu terima wajib diisi.")
    delivery.receiver_name = receiver_name
    delivery.received_time = received_time
    delivery.receipt_proof_id = proof_id
    delivery.status = Delivery.Status.DELIVERED
    delivery.closed_at = timezone.now()
    delivery.save()
    cogs = 0
    for line in delivery.lines.select_related("product_batch"):
        cogs += line.quantity * line.product_batch.unit_cost
        move_product_stock(
            tenant=delivery.tenant,
            batch=line.product_batch,
            transaction_type=ProductLedger.TransactionType.SALES_OUT,
            quantity=line.quantity,
            from_category=ProductLedger.Category.IN_TRANSIT,
            to_category="",
            reference_document=delivery.delivery_number,
            idempotency_key=f"delivery-close:{delivery.pk}:{line.pk}",
            user=user,
        )
    create_operational_journal_safe(
        tenant=delivery.tenant,
        event_type="delivery.cogs",
        amount=cogs,
        journal_date=delivery.date,
        source_type="Delivery",
        source_id=str(delivery.id),
        description=f"COGS pengiriman {delivery.delivery_number}",
        final=True,
        user=user,
    )
    record_audit(
        tenant=delivery.tenant,
        user=user,
        action="delivery_received",
        resource_type="Delivery",
        resource_id=delivery.id,
        after={"receiver": receiver_name, "received_time": received_time},
    )
    return delivery


@transaction.atomic
def receive_sales_return(
    *,
    delivery: Delivery,
    return_lines: list[dict],
    reason: str,
    condition: str,
    user: User,
) -> SalesReturn:
    sales_return = SalesReturn.objects.create(
        tenant=delivery.tenant,
        delivery=delivery,
        customer=delivery.sales_po.customer,
        return_number=next_document_number(delivery.tenant, "RET"),
        date=timezone.localdate(),
        received_at=timezone.now(),
        reason=reason,
        condition=condition,
    )
    adjustment_amount = 0
    for item in return_lines:
        delivery_line = DeliveryLine.objects.select_related(
            "sales_po_line__product_variant", "product_batch"
        ).get(tenant=delivery.tenant, delivery=delivery, pk=item["delivery_line_id"])
        quantity = int(item["quantity"])
        adjustment_amount += quantity * delivery_line.sales_po_line.unit_price
        if quantity <= 0 or quantity > delivery_line.quantity:
            raise ValueError("Kuantitas retur tidak valid.")
        SalesReturnLine.objects.create(
            tenant=delivery.tenant,
            sales_return=sales_return,
            delivery_line=delivery_line,
            product_variant=delivery_line.sales_po_line.product_variant,
            quantity=quantity,
        )
        move_product_stock(
            tenant=delivery.tenant,
            batch=delivery_line.product_batch,
            transaction_type=ProductLedger.TransactionType.SALES_RETURN,
            quantity=quantity,
            from_category="",
            to_category=ProductLedger.Category.RETURNED,
            reference_document=sales_return.return_number,
            idempotency_key=f"sales-return:{sales_return.pk}:{delivery_line.pk}",
            user=user,
        )
    create_operational_journal_safe(
        tenant=delivery.tenant,
        event_type="return.adjustment",
        amount=adjustment_amount,
        journal_date=sales_return.date,
        source_type="SalesReturn",
        source_id=str(sales_return.id),
        description=f"Penyesuaian retur {sales_return.return_number}",
        final=True,
        user=user,
    )
    record_audit(
        tenant=delivery.tenant,
        user=user,
        action="sales_return_received",
        resource_type="SalesReturn",
        resource_id=sales_return.id,
        reason=reason,
        after={"number": sales_return.return_number, "lines": return_lines},
    )
    return sales_return
