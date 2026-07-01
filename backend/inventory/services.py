"""Invariant ledger stok material dan produk jadi."""

from __future__ import annotations

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Case, DecimalField, F, Sum, Value, When
from django.utils import timezone

from backend.accounting.models import AccountingPeriod
from backend.core.models import Membership, Tenant, User
from backend.core.services import (
    ensure_business_policy,
    next_document_number,
    model_snapshot,
    record_audit,
    request_approval,
)
from backend.inventory.models import (
    PurchaseOrder,
    MaterialLedger,
    ProductBatch,
    ProductLedger,
    StockAdjustment,
)
from backend.masterdata.models import Material
from backend.production.models import ProductionOrder
from backend.sales.models import SalesPOLine, StockAllocation

MATERIAL_IN_TYPES = {
    MaterialLedger.TransactionType.RECEIPT,
    MaterialLedger.TransactionType.RETURN,
    MaterialLedger.TransactionType.ADJUSTMENT_IN,
}
MATERIAL_OUT_TYPES = {
    MaterialLedger.TransactionType.ISSUE,
    MaterialLedger.TransactionType.ADJUSTMENT_OUT,
    MaterialLedger.TransactionType.WASTE,
}


def _assert_period_not_closed(tenant: Tenant) -> None:
    period = AccountingPeriod.objects.filter(
        tenant=tenant,
        start_date__lte=timezone.localdate(),
        end_date__gte=timezone.localdate(),
    ).first()
    if period and period.status == AccountingPeriod.Status.CLOSED:
        raise ValueError(
            "Transaksi stok ditolak karena periode akuntansi sudah ditutup."
        )


def material_balance(tenant: Tenant | int, material: Material | str) -> Decimal:
    tenant_id = tenant.pk if isinstance(tenant, Tenant) else tenant
    material_id = material.pk if isinstance(material, Material) else material
    aggregate = MaterialLedger.objects.filter(
        tenant_id=tenant_id, material_id=material_id
    ).aggregate(
        balance=Sum(
            Case(
                When(transaction_type__in=MATERIAL_IN_TYPES, then=F("quantity")),
                When(transaction_type__in=MATERIAL_OUT_TYPES, then=-F("quantity")),
                default=Value(Decimal("0")),
                output_field=DecimalField(max_digits=18, decimal_places=4),
            )
        )
    )
    return aggregate["balance"] or Decimal("0")


def moving_average_cost(tenant: Tenant | int, material: Material | str) -> Decimal:
    tenant_id = tenant.pk if isinstance(tenant, Tenant) else tenant
    material_id = material.pk if isinstance(material, Material) else material
    quantity = Decimal("0")
    value = Decimal("0")
    for entry in MaterialLedger.objects.filter(
        tenant_id=tenant_id, material_id=material_id
    ).order_by("created_at", "id"):
        if entry.transaction_type in MATERIAL_IN_TYPES:
            quantity += entry.quantity
            value += entry.quantity * entry.unit_cost
        elif entry.transaction_type in MATERIAL_OUT_TYPES:
            average = value / quantity if quantity else entry.unit_cost
            quantity -= entry.quantity
            value -= entry.quantity * average
    return (value / quantity) if quantity else Decimal("0")


@transaction.atomic
def record_material_movement(
    *,
    tenant: Tenant,
    material: Material,
    transaction_type: str,
    quantity: Decimal,
    unit_cost: Decimal,
    reference_document: str,
    user: User,
    idempotency_key: str,
    production_order: ProductionOrder | None = None,
    reason: str = "",
    notes: str = "",
) -> MaterialLedger:
    """Catat mutasi append-only dan tolak saldo negatif operasional."""

    if material.tenant_id != tenant.pk:
        raise ValueError("Material berasal dari konveksi lain.")
    _assert_period_not_closed(tenant)
    if quantity <= 0:
        raise ValueError("Kuantitas mutasi harus lebih besar dari nol.")
    if not reference_document:
        raise ValueError("Mutasi stok wajib memiliki dokumen referensi.")
    if transaction_type not in MATERIAL_IN_TYPES | MATERIAL_OUT_TYPES:
        raise ValueError("Tipe transaksi stok material tidak valid.")
    if (
        transaction_type
        in {
            MaterialLedger.TransactionType.ADJUSTMENT_IN,
            MaterialLedger.TransactionType.ADJUSTMENT_OUT,
            MaterialLedger.TransactionType.WASTE,
        }
        and not reason
    ):
        raise ValueError("Penyesuaian atau waste wajib memiliki alasan.")
    if transaction_type == MaterialLedger.TransactionType.ISSUE and not (
        production_order or reason
    ):
        raise ValueError("Material keluar wajib terkait produksi atau alasan sah.")

    locked_material = Material.objects.select_for_update().get(
        pk=material.pk, tenant=tenant
    )
    existing = MaterialLedger.objects.filter(
        tenant=tenant, idempotency_key=idempotency_key
    ).first()
    if existing:
        return existing

    before = material_balance(tenant, locked_material)
    if transaction_type in MATERIAL_OUT_TYPES and before < quantity:
        raise ValueError("Stok material tidak mencukupi; stok negatif ditolak.")

    try:
        movement = MaterialLedger.objects.create(
            tenant=tenant,
            material=locked_material,
            transaction_type=transaction_type,
            quantity=quantity,
            unit_cost=unit_cost,
            reference_document=reference_document,
            production_order=production_order,
            reason=reason,
            notes=notes,
            responsible_user=user,
            conversion_ratio_snapshot=locked_material.conversion_ratio,
            idempotency_key=idempotency_key,
        )
    except IntegrityError:
        return MaterialLedger.objects.get(
            tenant=tenant, idempotency_key=idempotency_key
        )

    after = (
        before + quantity
        if transaction_type in MATERIAL_IN_TYPES
        else before - quantity
    )
    record_audit(
        tenant=tenant,
        user=user,
        action="material_stock_movement",
        resource_type="MaterialLedger",
        resource_id=movement.id,
        before={"balance": before},
        after={"balance": after, "quantity": quantity, "type": transaction_type},
        reason=reason,
    )
    return movement


def product_category_balance(
    tenant: Tenant | int,
    batch: ProductBatch | str,
    category: str,
) -> int:
    tenant_id = tenant.pk if isinstance(tenant, Tenant) else tenant
    batch_id = batch.pk if isinstance(batch, ProductBatch) else batch
    balance = 0
    for movement in ProductLedger.objects.filter(
        tenant_id=tenant_id, batch_id=batch_id
    ).only("from_category", "to_category", "quantity"):
        if movement.to_category == category:
            balance += movement.quantity
        if movement.from_category == category:
            balance -= movement.quantity
    return balance


@transaction.atomic
def move_product_stock(
    *,
    tenant: Tenant,
    batch: ProductBatch,
    transaction_type: str,
    quantity: int,
    from_category: str,
    to_category: str,
    reference_document: str,
    idempotency_key: str,
    user: User,
) -> ProductLedger:
    if quantity <= 0:
        raise ValueError("Kuantitas produk harus lebih besar dari nol.")
    _assert_period_not_closed(tenant)
    if batch.tenant_id != tenant.pk:
        raise ValueError("Batch berasal dari konveksi lain.")
    if from_category == to_category:
        raise ValueError("Kategori asal dan tujuan tidak boleh sama.")

    locked_batch = ProductBatch.objects.select_for_update().get(
        pk=batch.pk, tenant=tenant
    )
    existing = ProductLedger.objects.filter(
        tenant=tenant, idempotency_key=idempotency_key
    ).first()
    if existing:
        return existing
    if from_category:
        available = product_category_balance(tenant, locked_batch, from_category)
        if available < quantity:
            raise ValueError("Stok produk pada kategori asal tidak mencukupi.")

    movement = ProductLedger.objects.create(
        tenant=tenant,
        product_variant=locked_batch.product_variant,
        transaction_type=transaction_type,
        quantity=quantity,
        batch_lot_number=locked_batch.lot_number,
        batch=locked_batch,
        from_category=from_category,
        to_category=to_category,
        unit_cost=locked_batch.unit_cost,
        reference_document=reference_document,
        idempotency_key=idempotency_key,
    )
    record_audit(
        tenant=tenant,
        user=user,
        action="product_stock_movement",
        resource_type="ProductLedger",
        resource_id=movement.id,
        after={
            "batch": locked_batch.lot_number,
            "quantity": quantity,
            "from": from_category,
            "to": to_category,
            "unit_cost": locked_batch.unit_cost,
        },
    )
    return movement


@transaction.atomic
def allocate_product_stock(
    *,
    tenant: Tenant,
    sales_line: SalesPOLine,
    batch: ProductBatch,
    quantity: int,
    user: User,
    idempotency_key: str,
) -> StockAllocation:
    if sales_line.tenant_id != tenant.pk or batch.tenant_id != tenant.pk:
        raise ValueError("PO atau batch berasal dari konveksi lain.")
    outstanding = sales_line.quantity - sales_line.fulfilled_qty
    already_allocated = sum(
        allocation.allocated_qty - allocation.released_qty
        for allocation in sales_line.allocations.all()
    )
    if quantity <= 0 or already_allocated + quantity > outstanding:
        raise ValueError("Alokasi melebihi kebutuhan baris PO.")

    move_product_stock(
        tenant=tenant,
        batch=batch,
        transaction_type=ProductLedger.TransactionType.ADJUSTMENT_OUT,
        quantity=quantity,
        from_category=ProductLedger.Category.AVAILABLE,
        to_category=ProductLedger.Category.ALLOCATED,
        reference_document=sales_line.sales_po.po_number,
        idempotency_key=idempotency_key,
        user=user,
    )
    allocation, created = StockAllocation.objects.get_or_create(
        tenant=tenant,
        sales_po_line=sales_line,
        product_batch=batch,
        defaults={"allocated_qty": quantity},
    )
    if not created:
        allocation.allocated_qty += quantity
        allocation.save(update_fields=["allocated_qty", "updated_at"])
    return allocation


@transaction.atomic
def request_stock_adjustment(
    *,
    tenant: Tenant,
    material: Material,
    quantity: Decimal,
    unit_cost: Decimal,
    reason: str,
    user: User,
    proof_id: str | None = None,
) -> StockAdjustment:
    if not reason:
        raise ValueError("Stock adjustment wajib memiliki alasan.")
    policy = ensure_business_policy(tenant)
    impact_value = abs(quantity * unit_cost)
    significant = impact_value >= policy.significant_adjustment_value
    adjustment = StockAdjustment.objects.create(
        tenant=tenant,
        adjustment_number=next_document_number(tenant, "ADJ"),
        material=material,
        quantity=quantity,
        unit_cost=unit_cost,
        reason=reason,
        requested_by=user,
        proof_id=proof_id,
    )
    if significant:
        adjustment.approval = request_approval(
            tenant=tenant,
            user=user,
            action_type="significant_stock_adjustment",
            resource_type="StockAdjustment",
            resource_id=str(adjustment.id),
            reason=reason,
            payload={"quantity": str(quantity), "value": str(impact_value)},
        )
        adjustment.save(update_fields=["approval", "updated_at"])
    return adjustment


@transaction.atomic
def approve_and_post_stock_adjustment(
    adjustment: StockAdjustment, *, user: User
) -> StockAdjustment:
    adjustment = (
        StockAdjustment.objects.select_for_update()
        .select_related("tenant", "material", "approval")
        .get(pk=adjustment.pk)
    )
    membership = Membership.objects.filter(
        tenant=adjustment.tenant, user=user, is_active=True
    ).first()
    if membership is None or membership.role not in {
        Membership.Role.SUPER_ADMIN,
        Membership.Role.KEPALA_KONVEKSI,
    }:
        raise PermissionError("Role tidak berwenang menyetujui adjustment.")
    if adjustment.approval_id:
        if adjustment.approval.status != adjustment.approval.Status.APPROVED:
            raise PermissionError("Adjustment signifikan belum disetujui Super Admin.")
    adjustment.status = StockAdjustment.Status.APPROVED
    adjustment.approved_by = user
    movement_type = (
        MaterialLedger.TransactionType.ADJUSTMENT_IN
        if adjustment.quantity > 0
        else MaterialLedger.TransactionType.ADJUSTMENT_OUT
    )
    record_material_movement(
        tenant=adjustment.tenant,
        material=adjustment.material,
        transaction_type=movement_type,
        quantity=abs(adjustment.quantity),
        unit_cost=adjustment.unit_cost,
        reference_document=adjustment.adjustment_number,
        user=user,
        idempotency_key=f"stock-adjustment:{adjustment.pk}",
        reason=adjustment.reason,
    )
    adjustment.status = StockAdjustment.Status.POSTED
    adjustment.save(update_fields=["status", "approved_by", "updated_at"])
    return adjustment


def confirm_purchase_order(order: PurchaseOrder, *, user: User) -> PurchaseOrder:
    if order.status != PurchaseOrder.Status.DRAFT:
        raise ValueError("Hanya draft PO yang dapat dikonfirmasi.")

    before = model_snapshot(order)
    order.status = PurchaseOrder.Status.CONFIRMED
    order.save(update_fields=["status", "updated_at"])

    record_audit(
        tenant=order.tenant,
        user=user,
        action="purchase_order_confirmed",
        resource_type="PurchaseOrder",
        resource_id=order.id,
        before=before,
        after=model_snapshot(order),
    )
    return order


def cancel_purchase_order(order: PurchaseOrder, *, user: User) -> PurchaseOrder:
    if order.status not in {PurchaseOrder.Status.DRAFT, PurchaseOrder.Status.CONFIRMED}:
        raise ValueError("PO tidak dapat dibatalkan pada status saat ini.")

    before = model_snapshot(order)
    order.status = PurchaseOrder.Status.CANCELLED
    order.save(update_fields=["status", "updated_at"])

    record_audit(
        tenant=order.tenant,
        user=user,
        action="purchase_order_cancelled",
        resource_type="PurchaseOrder",
        resource_id=order.id,
        before=before,
        after=model_snapshot(order),
    )
    return order
