"""Workflow produksi, MRP, progres, costing, dan penerimaan produk jadi."""

from __future__ import annotations

from decimal import ROUND_CEILING, Decimal

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from backend.accounting.services import create_operational_journal_safe
from backend.core.models import Membership, Tenant, User
from backend.core.notifications import create_role_notifications
from backend.core.services import (
    ensure_business_policy,
    model_snapshot,
    record_audit,
    request_approval,
)
from backend.inventory.models import ProductBatch, ProductLedger, PurchaseOrderLine
from backend.inventory.services import (
    material_balance,
    move_product_stock,
    moving_average_cost,
)
from backend.masterdata.models import BOM, Operator, PieceRate, ProductVariant, Routing
from backend.production.models import (
    HPPSnapshot,
    JobPacket,
    MaterialRequirement,
    OperatorWorkLog,
    ProductionCost,
    ProductionOrder,
    ProductionStageProgress,
    ReworkOrder,
    ScrapRecord,
    WIPBalance,
)
from backend.sales.models import SalesPO

QUANTITY_QUANTUM = Decimal("0.0001")
CURRENCY_QUANTUM = Decimal("0.01")
UNIT_COST_QUANTUM = Decimal("0.0001")


def _quantity(value: Decimal) -> Decimal:
    return value.quantize(QUANTITY_QUANTUM)


def _effective_bom(order: ProductionOrder) -> BOM:
    if order.bom_id:
        return order.bom
    bom = (
        BOM.objects.filter(
            tenant=order.tenant,
            product_variant=order.product_variant,
            is_active=True,
            effective_date__lte=timezone.localdate(),
        )
        .prefetch_related("items__material")
        .order_by("-effective_date", "-version")
        .first()
    )
    if bom is None:
        raise ValueError("BOM efektif belum tersedia untuk varian produk.")
    return bom


def _effective_routing(order: ProductionOrder) -> Routing:
    if order.routing_id:
        return order.routing
    routing = (
        Routing.objects.filter(
            tenant=order.tenant,
            product_model=order.product_variant.product_model,
            is_active=True,
            effective_date__lte=timezone.localdate(),
        )
        .prefetch_related("stages")
        .order_by("-effective_date", "-version")
        .first()
    )
    if routing is None:
        raise ValueError("Routing efektif belum tersedia untuk produk.")
    return routing


@transaction.atomic
def estimate_hpp(
    *, tenant: Tenant, product_variant: ProductVariant, quantity: Decimal, user: User
) -> HPPSnapshot:
    """Snapshot HPP estimasi dari BOM, tarif, biaya material, dan margin efektif."""
    if product_variant.tenant_id != tenant.pk or quantity <= 0:
        raise ValueError("Varian atau kuantitas estimasi HPP tidak valid.")
    bom = (
        BOM.objects.filter(
            tenant=tenant,
            product_variant=product_variant,
            is_active=True,
            effective_date__lte=timezone.localdate(),
        )
        .prefetch_related("items__material")
        .order_by("-effective_date", "-version")
        .first()
    )
    routing = (
        Routing.objects.filter(
            tenant=tenant,
            product_model=product_variant.product_model,
            is_active=True,
            effective_date__lte=timezone.localdate(),
        )
        .prefetch_related("stages")
        .order_by("-effective_date", "-version")
        .first()
    )
    if bom is None or routing is None:
        raise ValueError("BOM dan routing efektif wajib tersedia.")
    material_cost = Decimal("0")
    material_detail = []
    for item in bom.items.all():
        usage = (
            item.quantity
            * quantity
            * (Decimal("1") + item.material.shrinkage_percent / Decimal("100"))
        )
        unit_cost = moving_average_cost(tenant, item.material)
        cost = usage * unit_cost
        material_cost += cost
        material_detail.append(
            {
                "material": item.material.code,
                "quantity": str(_quantity(usage)),
                "unit_cost": str(unit_cost.quantize(UNIT_COST_QUANTUM)),
                "cost": str(cost.quantize(CURRENCY_QUANTUM)),
            }
        )
    labor_cost = Decimal("0")
    labor_detail = []
    for stage in routing.stages.all():
        rate = (
            PieceRate.objects.filter(
                tenant=tenant,
                product_model=product_variant.product_model,
                stage_name=stage.stage_name,
                operator__isnull=True,
                is_active=True,
                effective_date__lte=timezone.localdate(),
            )
            .order_by("-effective_date")
            .first()
        )
        amount = (rate.rate_amount if rate else Decimal("0")) * quantity
        labor_cost += amount
        labor_detail.append(
            {"stage": stage.stage_name, "rate": str(rate.rate_amount if rate else 0)}
        )
    total_cost = (material_cost + labor_cost).quantize(CURRENCY_QUANTUM)
    unit_cost = (total_cost / quantity).quantize(UNIT_COST_QUANTUM)
    policy = ensure_business_policy(tenant)
    margin = (
        product_variant.default_margin_percent
        if product_variant.default_margin_percent is not None
        else policy.default_margin_percent
    )
    recommended = (unit_cost * (Decimal("1") + margin / Decimal("100"))).quantize(
        CURRENCY_QUANTUM
    )
    snapshot = HPPSnapshot.objects.create(
        tenant=tenant,
        product_variant=product_variant,
        cost_type=HPPSnapshot.CostType.ESTIMATED,
        total_cost=total_cost,
        quantity=quantity,
        unit_cost=unit_cost,
        components={
            "material": str(material_cost.quantize(CURRENCY_QUANTUM)),
            "labor": str(labor_cost.quantize(CURRENCY_QUANTUM)),
            "material_detail": material_detail,
            "labor_detail": labor_detail,
        },
        source_versions={"bom": bom.version, "routing": routing.version},
        margin_percent=margin,
        recommended_price=recommended,
    )
    record_audit(
        tenant=tenant,
        user=user,
        action="hpp_estimated",
        resource_type="HPPSnapshot",
        resource_id=snapshot.id,
        after={"unit_cost": unit_cost, "recommended_price": recommended},
    )
    return snapshot


@transaction.atomic
def recalculate_material_requirements(
    order: ProductionOrder,
) -> list[MaterialRequirement]:
    """Hitung kebutuhan, reservasi, pesanan berjalan, MOQ, dan kemasan."""

    order = (
        ProductionOrder.objects.select_for_update()
        .select_related("tenant", "product_variant")
        .get(pk=order.pk)
    )
    bom = _effective_bom(order)
    results: list[MaterialRequirement] = []
    for item in bom.items.select_related(
        "material", "material__purchase_uom", "material__usage_uom"
    ):
        material = item.material
        waste_multiplier = Decimal("1") + material.shrinkage_percent / Decimal("100")
        required = _quantity(item.quantity * order.target_quantity * waste_multiplier)
        available = material_balance(order.tenant, material)
        reserved_other = MaterialRequirement.objects.filter(
            tenant=order.tenant,
            material=material,
            production_order__status__in={
                ProductionOrder.Status.PLANNED,
                ProductionOrder.Status.RELEASED,
                ProductionOrder.Status.IN_PROGRESS,
            },
        ).exclude(production_order=order).aggregate(total=Sum("reserved_usage_qty"))[
            "total"
        ] or Decimal("0")
        ordered_purchase = PurchaseOrderLine.objects.filter(
            tenant=order.tenant,
            material=material,
            purchase_order__status__in={"confirmed", "partial_receipt"},
        ).aggregate(total=Sum("quantity") - Sum("received_qty"))["total"] or Decimal(
            "0"
        )
        ordered_usage = _quantity(ordered_purchase * material.conversion_ratio)
        net_available = max(Decimal("0"), available - reserved_other)
        shortage = _quantity(
            max(Decimal("0"), required - net_available - ordered_usage)
        )
        raw_purchase = (
            shortage / material.conversion_ratio if shortage else Decimal("0")
        )
        multiple = material.purchase_multiple or Decimal("1")
        rounded_purchase = (
            (raw_purchase / multiple).to_integral_value(rounding=ROUND_CEILING)
            * multiple
            if raw_purchase
            else Decimal("0")
        )
        if rounded_purchase and rounded_purchase < material.moq:
            rounded_purchase = material.moq
        packaging_excess = _quantity(
            max(Decimal("0"), rounded_purchase * material.conversion_ratio - shortage)
        )
        requirement, _created = MaterialRequirement.objects.update_or_create(
            tenant=order.tenant,
            production_order=order,
            material=material,
            defaults={
                "required_usage_qty": required,
                "available_usage_qty": net_available,
                "reserved_usage_qty": min(required, net_available),
                "ordered_purchase_qty": ordered_purchase,
                "shortage_usage_qty": shortage,
                "recommended_purchase_qty": rounded_purchase,
                "packaging_excess_usage_qty": packaging_excess,
                "calculation_version": bom.version,
            },
        )
        results.append(requirement)
        if shortage > 0:
            create_role_notifications(
                tenant=order.tenant,
                event_type="material_shortage",
                title=f"Kekurangan material {material.code}",
                message=(
                    f"{order.order_number}: kurang {shortage} {material.usage_uom.code}."
                ),
                safe_path=f"/production/orders/{order.id}",
                deduplication_key=(
                    f"mrp:{order.id}:{material.id}:{requirement.calculation_version}:{shortage}"
                ),
                roles={Membership.Role.KEPALA_KONVEKSI},
                operator_types={
                    Operator.OperatorType.GUDANG,
                    Operator.OperatorType.PEMBELIAN,
                },
                telegram=True,
            )
    return results


@transaction.atomic
def release_production_order(order: ProductionOrder, *, user: User) -> ProductionOrder:
    order = (
        ProductionOrder.objects.select_for_update(of=("self",))
        .select_related(
            "tenant", "product_variant__product_model", "sales_po_line__sales_po"
        )
        .get(pk=order.pk)
    )
    if order.status not in {
        ProductionOrder.Status.DRAFT,
        ProductionOrder.Status.PLANNED,
    }:
        raise ValueError(
            "Hanya Production Order draft/direncanakan yang dapat dirilis."
        )
    if order.target_completion_date is None:
        raise ValueError("Target selesai internal wajib diisi sebelum rilis.")
    if (
        order.order_type == ProductionOrder.Type.FOR_PO
        and order.sales_po_line_id is None
    ):
        raise ValueError("Produksi untuk PO wajib terhubung ke baris PO.")
    if order.order_type == ProductionOrder.Type.FOR_STOCK and order.sales_po_line_id:
        raise ValueError("Produksi stok tidak boleh terhubung ke baris PO.")

    before = model_snapshot(order)
    bom = _effective_bom(order)
    routing = _effective_routing(order)
    order.bom = bom
    order.routing = routing
    order.bom_snapshot = {
        "id": str(bom.id),
        "version": bom.version,
        "items": [
            {
                "material_id": str(item.material_id),
                "quantity": str(item.quantity),
                "conversion_ratio": str(item.material.conversion_ratio),
            }
            for item in bom.items.select_related("material")
        ],
    }
    order.routing_snapshot = {
        "id": str(routing.id),
        "version": routing.version,
        "stages": [
            {
                "id": str(stage.id),
                "sequence": stage.sequence,
                "name": stage.stage_name,
                "rule": stage.transition_rule,
            }
            for stage in routing.stages.all()
        ],
    }
    order.status = ProductionOrder.Status.RELEASED
    order.released_at = timezone.now()
    order.save()

    if order.sales_po_line_id:
        sales_po = order.sales_po_line.sales_po
        if not sales_po.is_locked:
            sales_po.is_locked = True
            sales_po.locked_at = timezone.now()
            sales_po.lock_reason = "production_order_released"
            sales_po.status = SalesPO.Status.IN_PRODUCTION
            sales_po.save()
    recalculate_material_requirements(order)
    record_audit(
        tenant=order.tenant,
        user=user,
        action="production_order_released",
        resource_type="ProductionOrder",
        resource_id=order.id,
        before=before,
        after=model_snapshot(order),
    )
    return order


@transaction.atomic
def submit_stage_progress(
    *,
    packet: JobPacket,
    stage_id: str,
    operator_id: str,
    qty_in: int,
    qty_good: int,
    qty_defect: int,
    qty_rework: int,
    qty_scrap: int,
    qty_remaining: int,
    defect_type: str,
    duration_minutes: int,
    user: User,
) -> ProductionStageProgress:
    packet = (
        JobPacket.objects.select_for_update(of=("self",))
        .select_related("tenant", "production_order", "assigned_operator")
        .get(pk=packet.pk)
    )
    if packet.status in {JobPacket.Status.VERIFIED, JobPacket.Status.PAID}:
        raise ValueError(
            "Paket yang sudah diverifikasi/dibayar tidak dapat diubah operator."
        )
    if packet.assigned_operator_id and str(packet.assigned_operator_id) != str(
        operator_id
    ):
        raise PermissionError("Paket tidak ditugaskan kepada operator ini.")
    if qty_good + qty_defect + qty_scrap + qty_remaining != qty_in:
        raise ValueError("Keseimbangan kuantitas tahap tidak valid.")
    if qty_rework > qty_defect:
        raise ValueError("Qty rework tidak boleh melebihi qty cacat.")

    progress = ProductionStageProgress.objects.create(
        tenant=packet.tenant,
        job_packet=packet,
        stage_id=stage_id,
        operator_id=operator_id,
        qty_in=qty_in,
        qty_good=qty_good,
        qty_defect=qty_defect,
        qty_rework=qty_rework,
        qty_scrap=qty_scrap,
        qty_remaining=qty_remaining,
        defect_type=defect_type,
        duration_minutes=duration_minutes,
        submitted_at=timezone.now(),
    )
    WIPBalance.objects.update_or_create(
        tenant=packet.tenant,
        production_order=packet.production_order,
        stage_id=stage_id,
        defaults={"quantity": qty_remaining},
    )
    if qty_rework:
        ReworkOrder.objects.create(
            tenant=packet.tenant,
            source_progress=progress,
            target_stage_id=stage_id,
            operator_id=operator_id,
            quantity=qty_rework,
        )
    if qty_scrap:
        scrap = ScrapRecord.objects.create(
            tenant=packet.tenant,
            production_order=packet.production_order,
            source_progress=progress,
            quantity=qty_scrap,
            reason=defect_type or "Scrap dari pelaporan progres produksi",
            responsible_operator_id=operator_id,
        )
        scrap.approval = request_approval(
            tenant=packet.tenant,
            user=user,
            action_type="approve_production_scrap",
            resource_type="ScrapRecord",
            resource_id=str(scrap.id),
            reason=scrap.reason,
            payload={
                "quantity": qty_scrap,
                "production_order_id": packet.production_order_id,
            },
        )
        scrap.save(update_fields=["approval", "updated_at"])
    packet.status = JobPacket.Status.SUBMITTED
    packet.submitted_at = progress.submitted_at
    packet.save(update_fields=["status", "submitted_at", "updated_at"])
    order = packet.production_order
    if order.status == ProductionOrder.Status.RELEASED:
        order.status = ProductionOrder.Status.IN_PROGRESS
        order.save(update_fields=["status", "updated_at"])
    record_audit(
        tenant=packet.tenant,
        user=user,
        action="production_progress_submitted",
        resource_type="ProductionStageProgress",
        resource_id=progress.id,
        after=model_snapshot(progress),
    )
    return progress


@transaction.atomic
def complete_rework(
    rework: ReworkOrder, *, result_good: int, result_scrap: int, user: User
) -> ReworkOrder:
    rework = (
        ReworkOrder.objects.select_for_update()
        .select_related("tenant")
        .get(pk=rework.pk)
    )
    if rework.status in {ReworkOrder.Status.PASSED, ReworkOrder.Status.FAILED}:
        raise ValueError("Rework sudah diselesaikan.")
    if (
        result_good < 0
        or result_scrap < 0
        or result_good + result_scrap != rework.quantity
    ):
        raise ValueError("Hasil baik dan scrap harus sama dengan kuantitas rework.")
    before = model_snapshot(rework)
    rework.result_good = result_good
    rework.result_scrap = result_scrap
    rework.status = (
        ReworkOrder.Status.PASSED if result_good else ReworkOrder.Status.FAILED
    )
    rework.save()
    record_audit(
        tenant=rework.tenant,
        user=user,
        action="production_rework_completed",
        resource_type="ReworkOrder",
        resource_id=rework.id,
        before=before,
        after=model_snapshot(rework),
    )
    return rework


@transaction.atomic
def approve_scrap(scrap: ScrapRecord, *, user: User) -> ScrapRecord:
    scrap = (
        ScrapRecord.objects.select_for_update()
        .select_related("tenant")
        .get(pk=scrap.pk)
    )
    if scrap.approved_by_id:
        raise ValueError("Scrap sudah disetujui.")
    scrap.approved_by = user
    scrap.save(update_fields=["approved_by", "updated_at"])
    record_audit(
        tenant=scrap.tenant,
        user=user,
        action="production_scrap_approved",
        resource_type="ScrapRecord",
        resource_id=scrap.id,
        after=model_snapshot(scrap),
    )
    return scrap


@transaction.atomic
def verify_stage_progress(
    progress: ProductionStageProgress,
    *,
    user: User,
    correction: dict | None = None,
    reason: str = "",
) -> ProductionStageProgress:
    progress = (
        ProductionStageProgress.objects.select_for_update()
        .select_related(
            "tenant",
            "operator",
            "job_packet__production_order__product_variant__product_model",
        )
        .get(pk=progress.pk)
    )
    before = model_snapshot(progress)
    if correction:
        if not reason:
            raise ValueError("Koreksi hasil operator wajib memiliki alasan.")
        for field in (
            "qty_in",
            "qty_good",
            "qty_defect",
            "qty_rework",
            "qty_scrap",
            "qty_remaining",
            "defect_type",
            "duration_minutes",
        ):
            if field in correction:
                setattr(progress, field, correction[field])
        progress.correction_reason = reason
    progress.is_verified = True
    progress.verified_by = user
    progress.verified_at = timezone.now()
    progress.save()

    packet = progress.job_packet
    packet.status = JobPacket.Status.VERIFIED
    packet.verified_at = progress.verified_at
    packet.save(update_fields=["status", "verified_at", "updated_at"])

    rate = (
        PieceRate.objects.filter(
            tenant=progress.tenant,
            product_model=packet.production_order.product_variant.product_model,
            stage_name=progress.stage.stage_name,
            is_active=True,
            effective_date__lte=timezone.localdate(),
        )
        .filter(Q(operator=progress.operator) | Q(operator__isnull=True))
        .order_by("-operator_id", "-effective_date")
        .first()
    )
    applied_rate = rate.rate_amount if rate else Decimal("0")
    OperatorWorkLog.objects.update_or_create(
        tenant=progress.tenant,
        progress=progress,
        operator=progress.operator,
        defaults={
            "qty_claimed": progress.qty_good,
            "piece_rate_applied": applied_rate,
            "amount_total": applied_rate * progress.qty_good,
            "is_verified": True,
            "verified_by": user,
            "verified_at": progress.verified_at,
        },
    )
    record_audit(
        tenant=progress.tenant,
        user=user,
        action="production_progress_verified",
        resource_type="ProductionStageProgress",
        resource_id=progress.id,
        before=before,
        after=model_snapshot(progress),
        reason=reason,
    )
    return progress


@transaction.atomic
def complete_production_order(
    order: ProductionOrder,
    *,
    output_quantity: int,
    lot_number: str,
    user: User,
) -> tuple[ProductionOrder, ProductBatch, HPPSnapshot]:
    order = (
        ProductionOrder.objects.select_for_update(of=("self",))
        .select_related("tenant", "product_variant", "sales_po_line__sales_po")
        .get(pk=order.pk)
    )
    if order.status not in {
        ProductionOrder.Status.IN_PROGRESS,
        ProductionOrder.Status.QC_PACKING,
    }:
        raise ValueError("Production Order belum siap diselesaikan.")
    if output_quantity <= 0:
        raise ValueError("Output produksi harus lebih besar dari nol.")
    if order.job_packets.exclude(
        status__in={
            JobPacket.Status.VERIFIED,
            JobPacket.Status.BILLABLE,
            JobPacket.Status.PAID,
        }
    ).exists():
        raise ValueError(
            "Seluruh paket kerja wajib diverifikasi sebelum produksi selesai."
        )
    if ReworkOrder.objects.filter(
        tenant=order.tenant,
        source_progress__job_packet__production_order=order,
        status__in={ReworkOrder.Status.OPEN, ReworkOrder.Status.IN_PROGRESS},
    ).exists():
        raise ValueError("Masih ada rework yang belum selesai.")
    if ScrapRecord.objects.filter(
        production_order=order, approved_by__isnull=True
    ).exists():
        raise ValueError("Masih ada scrap yang belum disetujui.")

    material_cost = sum(
        item.quantity * item.unit_cost for item in order.material_consumptions.all()
    )
    labor_cost = OperatorWorkLog.objects.filter(
        progress__job_packet__production_order=order, is_verified=True
    ).aggregate(total=Sum("amount_total"))["total"] or Decimal("0")
    other_cost = ProductionCost.objects.filter(production_order=order).aggregate(
        total=Sum("amount")
    )["total"] or Decimal("0")
    material_cost = material_cost.quantize(CURRENCY_QUANTUM)
    labor_cost = labor_cost.quantize(CURRENCY_QUANTUM)
    other_cost = other_cost.quantize(CURRENCY_QUANTUM)
    total_cost = (material_cost + labor_cost + other_cost).quantize(CURRENCY_QUANTUM)
    unit_cost = (total_cost / output_quantity).quantize(UNIT_COST_QUANTUM)
    hpp = HPPSnapshot.objects.create(
        tenant=order.tenant,
        production_order=order,
        product_variant=order.product_variant,
        cost_type=HPPSnapshot.CostType.ACTUAL,
        total_cost=total_cost,
        quantity=output_quantity,
        unit_cost=unit_cost,
        components={
            "material": str(material_cost),
            "labor": str(labor_cost),
            "other": str(other_cost),
        },
        source_versions={
            "bom": order.bom_snapshot,
            "routing": order.routing_snapshot,
        },
    )
    batch = ProductBatch.objects.create(
        tenant=order.tenant,
        product_variant=order.product_variant,
        lot_number=lot_number,
        production_order=order,
        received_quantity=output_quantity,
        unit_cost=unit_cost,
    )
    move_product_stock(
        tenant=order.tenant,
        batch=batch,
        transaction_type=ProductLedger.TransactionType.PRODUCTION_IN,
        quantity=output_quantity,
        from_category="",
        to_category=ProductLedger.Category.AVAILABLE,
        reference_document=order.order_number,
        idempotency_key=f"production-output:{order.pk}",
        user=user,
    )
    create_operational_journal_safe(
        tenant=order.tenant,
        event_type="production.completed",
        amount=total_cost,
        journal_date=timezone.localdate(),
        source_type="ProductionOrder",
        source_id=str(order.id),
        description=f"Penerimaan hasil produksi {order.order_number}",
        final=True,
        user=user,
    )
    order.output_quantity = output_quantity
    order.status = ProductionOrder.Status.COMPLETED
    order.completed_at = timezone.now()
    order.save(
        update_fields=["output_quantity", "status", "completed_at", "updated_at"]
    )
    if order.sales_po_line_id:
        line = order.sales_po_line
        line.produced_qty += output_quantity
        line.save(update_fields=["produced_qty", "updated_at"])
    record_audit(
        tenant=order.tenant,
        user=user,
        action="production_order_completed",
        resource_type="ProductionOrder",
        resource_id=order.id,
        after={
            "output_quantity": output_quantity,
            "batch": lot_number,
            "actual_unit_cost": unit_cost,
        },
    )
    return order, batch, hpp
