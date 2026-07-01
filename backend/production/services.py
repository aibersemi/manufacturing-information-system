"""Workflow produksi, MRP, progres, costing, dan penerimaan produk jadi."""

from __future__ import annotations

from decimal import ROUND_CEILING, Decimal
from uuid import UUID

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
    next_document_number,
)
from backend.inventory.models import (
    ProductBatch,
    ProductLedger,
    PurchaseOrderLine,
    PurchaseRequest,
    MaterialLedger,
)
from backend.inventory.services import (
    material_balance,
    move_product_stock,
    moving_average_cost,
    record_material_movement,
)
from backend.masterdata.models import (
    BOM,
    Material,
    Operator,
    PieceRate,
    ProductVariant,
    Routing,
)
from backend.production.models import (
    MaterialConsumption,
    MaterialReservation,
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
from backend.sales.models import SalesPO, SalesPOLine

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


def _bom_snapshot(bom: BOM) -> dict:
    variant = bom.product_variant
    return {
        "id": str(bom.id),
        "version": bom.version,
        "captured_at": timezone.now().isoformat(),
        "product_variant": {
            "id": str(variant.id),
            "sku": variant.sku,
            "color": variant.color,
            "size": variant.size,
        },
        "items": [
            {
                "bom_item_id": str(item.id),
                "material_id": str(item.material_id),
                "material_code": item.material.code,
                "material_name": item.material.name,
                "quantity_per_unit": str(item.quantity),
                "quantity": str(item.quantity),
                "usage_uom_code": item.material.usage_uom.code,
                "purchase_uom_code": item.material.purchase_uom.code,
                "conversion_ratio": str(item.material.conversion_ratio),
                "shrinkage_percent": str(item.material.shrinkage_percent),
                "moq": str(item.material.moq),
                "purchase_multiple": str(item.material.purchase_multiple),
                "last_purchase_price": str(item.material.last_purchase_price)
                if item.material.last_purchase_price is not None
                else None,
            }
            for item in bom.items.select_related(
                "material", "material__usage_uom", "material__purchase_uom"
            ).order_by("created_at", "id")
        ],
    }


def _snapshot_quantity(item: dict) -> Decimal:
    return Decimal(str(item.get("quantity_per_unit") or item.get("quantity") or "0"))


def _snapshot_material_id(item: dict) -> UUID:
    return UUID(str(item["material_id"]))


def _snapshot_items(order: ProductionOrder) -> list[dict]:
    items = order.bom_snapshot.get("items") if order.bom_snapshot else None
    if items:
        return items

    bom = _effective_bom(order)
    order.bom = bom
    order.bom_snapshot = _bom_snapshot(bom)
    order.save(update_fields=["bom", "bom_snapshot", "updated_at"])
    return order.bom_snapshot["items"]


@transaction.atomic
def snapshot_material_requirements_from_bom(
    order: ProductionOrder, *, user: User | None = None, replace: bool = True
) -> list[MaterialRequirement]:
    """Salin BOM efektif ke kebutuhan material milik SPK."""

    order = (
        ProductionOrder.objects.select_for_update()
        .select_related("tenant", "product_variant")
        .get(pk=order.pk)
    )
    if replace and (
        MaterialReservation.objects.filter(requirement__production_order=order).exists()
        or MaterialConsumption.objects.filter(production_order=order).exists()
    ):
        raise ValueError(
            "Snapshot bahan SPK tidak dapat diganti setelah material direservasi/dikeluarkan."
        )

    before = model_snapshot(order)
    bom = _effective_bom(order)
    order.bom = bom
    order.bom_snapshot = _bom_snapshot(bom)
    order.save(update_fields=["bom", "bom_snapshot", "updated_at"])

    if replace:
        MaterialRequirement.objects.filter(tenant=order.tenant, production_order=order).delete()
    requirements = recalculate_material_requirements(order)
    if user:
        record_audit(
            tenant=order.tenant,
            user=user,
            action="production_order_bom_snapshotted",
            resource_type="ProductionOrder",
            resource_id=order.id,
            before=before,
            after=model_snapshot(order),
        )
    return requirements


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
    snapshot_items = _snapshot_items(order)
    material_ids = [_snapshot_material_id(item) for item in snapshot_items]
    materials = {
        material.id: material
        for material in Material.objects.filter(
            tenant=order.tenant, id__in=material_ids
        ).select_related("usage_uom", "purchase_uom")
    }
    results: list[MaterialRequirement] = []
    for item in snapshot_items:
        material_id = _snapshot_material_id(item)
        material = materials.get(material_id)
        if material is None:
            raise ValueError("Material snapshot SPK tidak ditemukan.")
        quantity_per_unit = _snapshot_quantity(item)
        shrinkage_percent = Decimal(
            str(item.get("shrinkage_percent") or material.shrinkage_percent)
        )
        conversion_ratio = Decimal(
            str(item.get("conversion_ratio") or material.conversion_ratio)
        )
        usage_uom_code = item.get("usage_uom_code") or material.usage_uom.code
        purchase_uom_code = item.get("purchase_uom_code") or material.purchase_uom.code
        waste_multiplier = Decimal("1") + shrinkage_percent / Decimal("100")
        required = _quantity(quantity_per_unit * order.target_quantity * waste_multiplier)
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
        ordered_usage = _quantity(ordered_purchase * conversion_ratio)
        net_available = max(Decimal("0"), available - reserved_other)
        shortage = _quantity(
            max(Decimal("0"), required - net_available - ordered_usage)
        )
        raw_purchase = (
            shortage / conversion_ratio if shortage else Decimal("0")
        )
        multiple = Decimal(str(item.get("purchase_multiple") or material.purchase_multiple or "1"))
        rounded_purchase = (
            (raw_purchase / multiple).to_integral_value(rounding=ROUND_CEILING)
            * multiple
            if raw_purchase
            else Decimal("0")
        )
        moq = Decimal(str(item.get("moq") or material.moq or "1"))
        if rounded_purchase and rounded_purchase < moq:
            rounded_purchase = moq
        packaging_excess = _quantity(
            max(Decimal("0"), rounded_purchase * conversion_ratio - shortage)
        )
        requirement, _created = MaterialRequirement.objects.update_or_create(
            tenant=order.tenant,
            production_order=order,
            material=material,
            defaults={
                "source_bom_item_id": item.get("bom_item_id"),
                "material_code_snapshot": item.get("material_code") or material.code,
                "material_name_snapshot": item.get("material_name") or material.name,
                "quantity_per_unit": quantity_per_unit,
                "usage_uom_code_snapshot": usage_uom_code,
                "purchase_uom_code_snapshot": purchase_uom_code,
                "conversion_ratio_snapshot": conversion_ratio,
                "shrinkage_percent_snapshot": shrinkage_percent,
                "required_usage_qty": required,
                "available_usage_qty": net_available,
                "reserved_usage_qty": min(required, net_available),
                "ordered_purchase_qty": ordered_purchase,
                "shortage_usage_qty": shortage,
                "recommended_purchase_qty": rounded_purchase,
                "packaging_excess_usage_qty": packaging_excess,
                "calculation_version": order.bom_snapshot.get("version", 1),
            },
        )
        results.append(requirement)
        if shortage > 0:
            create_role_notifications(
                tenant=order.tenant,
                event_type="material_shortage",
                title=f"Kekurangan material {material.code}",
                message=(
                    f"{order.order_number}: kurang {shortage} {usage_uom_code}."
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
    routing = _effective_routing(order)
    if not (order.bom_snapshot or {}).get("items"):
        snapshot_material_requirements_from_bom(order, user=user, replace=False)
        order.refresh_from_db()
    order.routing = routing
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
                "production_order_id": str(packet.production_order_id),
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

    material_cost = Decimal(
        sum(
            item.quantity * item.unit_cost for item in order.material_consumptions.all()
        )
    )
    labor_cost = Decimal(
        OperatorWorkLog.objects.filter(
            progress__job_packet__production_order=order, is_verified=True
        ).aggregate(total=Sum("amount_total"))["total"]
        or "0"
    )
    other_cost = Decimal(
        ProductionCost.objects.filter(production_order=order).aggregate(
            total=Sum("amount")
        )["total"]
        or "0"
    )
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


@transaction.atomic
def create_production_order_from_sales_po_line(
    sales_po_line: SalesPOLine,
    *,
    target_quantity: int,
    target_completion_date=None,
    user: User,
) -> ProductionOrder:
    if target_quantity <= 0:
        raise ValueError("Target kuantitas harus lebih besar dari nol.")

    tenant = sales_po_line.tenant
    order_number = next_document_number(tenant, "PROD")

    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number=order_number,
        order_type=ProductionOrder.Type.FOR_PO,
        sales_po_line=sales_po_line,
        product_variant=sales_po_line.product_variant,
        target_quantity=target_quantity,
        status=ProductionOrder.Status.DRAFT,
        target_completion_date=target_completion_date,
    )
    snapshot_material_requirements_from_bom(order, user=user)
    order.refresh_from_db()

    record_audit(
        tenant=tenant,
        user=user,
        action="production_order_created_from_po",
        resource_type="ProductionOrder",
        resource_id=order.id,
        after=model_snapshot(order),
    )
    return order


@transaction.atomic
def reserve_materials_for_order(
    order: ProductionOrder, *, user: User
) -> list[MaterialReservation]:
    order = ProductionOrder.objects.select_for_update().get(pk=order.pk)
    if order.status not in {
        ProductionOrder.Status.PLANNED,
        ProductionOrder.Status.RELEASED,
        ProductionOrder.Status.IN_PROGRESS,
    }:
        raise ValueError("Production Order belum siap untuk reservasi material.")

    reservations = []
    requirements = order.material_requirements.select_related("material").all()
    for req in requirements:
        req = MaterialRequirement.objects.select_for_update().get(pk=req.pk)
        if req.reserved_usage_qty > 0:
            res, created = MaterialReservation.objects.update_or_create(
                tenant=order.tenant,
                requirement=req,
                defaults={"quantity": req.reserved_usage_qty},
            )
            reservations.append(res)

    record_audit(
        tenant=order.tenant,
        user=user,
        action="material_reserved",
        resource_type="ProductionOrder",
        resource_id=order.id,
        after={"reservations": [str(r.id) for r in reservations]},
    )
    return reservations


@transaction.atomic
def generate_purchase_requests_from_requirements(
    order: ProductionOrder, *, user: User
) -> list[PurchaseRequest]:
    if order.status not in {
        ProductionOrder.Status.PLANNED,
        ProductionOrder.Status.RELEASED,
    }:
        raise ValueError("Production Order belum siap untuk pengajuan pembelian.")

    requests = []
    requirements = order.material_requirements.select_related("material").filter(
        recommended_purchase_qty__gt=0
    )
    for req in requirements:
        existing_pr = PurchaseRequest.objects.filter(
            tenant=order.tenant,
            production_order=order,
            material=req.material,
            status=PurchaseRequest.Status.DRAFT,
        ).first()

        if existing_pr:
            existing_pr.requested_qty = req.recommended_purchase_qty
            existing_pr.save(update_fields=["requested_qty", "updated_at"])
            requests.append(existing_pr)
        else:
            pr = PurchaseRequest.objects.create(
                tenant=order.tenant,
                production_order=order,
                material=req.material,
                status=PurchaseRequest.Status.DRAFT,
                pr_number=next_document_number(order.tenant, "PR"),
                requested_qty=req.recommended_purchase_qty,
            )
            requests.append(pr)

    record_audit(
        tenant=order.tenant,
        user=user,
        action="purchase_requests_generated",
        resource_type="ProductionOrder",
        resource_id=order.id,
        after={"requests": [str(r.id) for r in requests]},
    )
    return requests


@transaction.atomic
def issue_materials_to_production(
    order: ProductionOrder, *, user: User
) -> list[MaterialConsumption]:
    if order.status not in {
        ProductionOrder.Status.RELEASED,
        ProductionOrder.Status.IN_PROGRESS,
    }:
        raise ValueError(
            "Production Order tidak dapat menerima issue material pada status saat ini."
        )

    consumptions = []
    from django.db import models

    reservations_ids = order.material_requirements.filter(
        reservations__isnull=False
    ).values_list("reservations__id", flat=True)
    res_qs = MaterialReservation.objects.filter(
        id__in=reservations_ids, quantity__gt=models.F("released_quantity")
    ).select_related("requirement__material")

    for res in res_qs:
        qty_to_issue = res.quantity - res.released_quantity
        if qty_to_issue <= 0:
            continue

        material = res.requirement.material

        bal = material_balance(order.tenant, material)
        if bal < qty_to_issue:
            raise ValueError(
                f"Stok material {material.name} tidak mencukupi untuk dikeluarkan sejumlah {qty_to_issue}."
            )

        avg_cost = moving_average_cost(order.tenant, material)

        ledger = record_material_movement(
            tenant=order.tenant,
            material=material,
            transaction_type=MaterialLedger.TransactionType.ISSUE,
            quantity=qty_to_issue,
            unit_cost=avg_cost,
            reference_document=order.order_number,
            user=user,
            idempotency_key=f"issue:{order.id}:{res.id}:{qty_to_issue}",
            production_order=order,
            reason="Kebutuhan produksi SPK",
        )

        consumption = MaterialConsumption.objects.create(
            tenant=order.tenant,
            production_order=order,
            material=material,
            quantity=qty_to_issue,
            unit_cost=avg_cost,
            inventory_reference=ledger.reference_document,
        )
        consumptions.append(consumption)

        res.released_quantity += qty_to_issue
        res.save(update_fields=["released_quantity", "updated_at"])

    record_audit(
        tenant=order.tenant,
        user=user,
        action="material_issued",
        resource_type="ProductionOrder",
        resource_id=order.id,
        after={"consumptions": [str(c.id) for c in consumptions]},
    )
    return consumptions


def adjust_operator_work_log_rate(
    work_log: OperatorWorkLog, *, user: User, new_rate: Decimal, reason: str
) -> OperatorWorkLog:
    if not reason:
        raise ValueError("Alasan penyesuaian tarif borongan wajib diisi.")

    if work_log.is_paid:
        raise ValueError("Tidak dapat mengubah tarif borongan yang sudah dibayar.")

    before = model_snapshot(work_log)

    work_log.piece_rate_applied = new_rate
    work_log.amount_total = new_rate * work_log.qty_claimed
    work_log.rate_adjustment_reason = reason
    if not work_log.is_verified:
        work_log.is_verified = True
        work_log.verified_by = user
        from django.utils import timezone

        work_log.verified_at = timezone.now()

    work_log.save(
        update_fields=[
            "piece_rate_applied",
            "amount_total",
            "rate_adjustment_reason",
            "is_verified",
            "verified_by",
            "verified_at",
            "updated_at",
        ]
    )

    record_audit(
        tenant=work_log.tenant,
        user=user,
        action="work_log_rate_adjusted",
        resource_type="OperatorWorkLog",
        resource_id=work_log.id,
        before=before,
        after=model_snapshot(work_log),
    )
    return work_log


@transaction.atomic
def create_operator_payment_request(
    work_log_ids: list[str], *, user: User, due_date=None
):
    work_logs = list(
        OperatorWorkLog.objects.filter(id__in=work_log_ids).select_related(
            "operator", "tenant"
        )
    )
    if not work_logs:
        raise ValueError("Tidak ada log kerja yang dipilih.")

    tenant = work_logs[0].tenant
    operator = work_logs[0].operator

    total_amount = Decimal("0")
    for log in work_logs:
        if log.tenant != tenant:
            raise ValueError("Log kerja berasal dari tenant yang berbeda.")
        if log.operator != operator:
            raise ValueError("Log kerja berasal dari operator yang berbeda.")
        if not log.is_verified:
            raise ValueError(
                "Hanya log kerja yang sudah diverifikasi yang dapat diajukan pembayaran."
            )
        if log.is_paid:
            raise ValueError("Log kerja sudah dibayar.")
        total_amount += log.amount_total

    source_ids = ",".join(str(log.id) for log in work_logs)

    if operator.operator_type == Operator.OperatorType.MAKLON:
        request_type = "maklon_piece_rate"
    else:
        request_type = "operator_piece_rate"

    from backend.finance.services import submit_payment_request

    payment_request = submit_payment_request(
        tenant=tenant,
        user=user,
        request_type=request_type,
        source_type="OperatorWorkLogBatch",
        source_id=source_ids,
        amount=total_amount,
        recipient=operator.name,
        due_date=due_date,
    )

    return payment_request
