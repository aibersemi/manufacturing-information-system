from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import (
    ROLE_OPERATOR,
    require_any_capability,
    require_capability,
    tenant_session_auth,
)
from backend.core.capabilities import (
    operator_can_submit_stage,
    require_assigned_operator,
    require_operator_context,
)
from backend.core.services import model_snapshot, next_document_number, record_audit
from backend.masterdata.models import ProductVariant, RoutingStage
from backend.sales.models import SalesPOLine
from backend.production.models import (
    OperatorWorkLog,
    JobPacket,
    MaterialRequirement,
    ProductionCost,
    ProductionOrder,
    ProductionStageProgress,
    ReworkOrder,
    ScrapRecord,
)
from backend.production.services import (
    create_production_order_from_sales_po_line,
    reserve_materials_for_order,
    generate_purchase_requests_from_requirements,
    issue_materials_to_production,
    adjust_operator_work_log_rate,
    create_operator_payment_request,
    recalculate_material_requirements,
    approve_scrap,
    complete_production_order,
    complete_rework,
    estimate_hpp,
    release_production_order,
    snapshot_material_requirements_from_bom,
    submit_stage_progress,
    verify_stage_progress,
)

router = Router(tags=["Production"], auth=tenant_session_auth)


class HPPEstimatePayload(Schema):
    product_variant_id: UUID
    quantity: Decimal


class HPPResponse(Schema):
    id: UUID
    product_variant_id: UUID
    cost_type: str
    total_cost: Decimal
    quantity: Decimal
    unit_cost: Decimal
    components: dict
    source_versions: dict
    margin_percent: Decimal
    recommended_price: Decimal


class ProductionCostPayload(Schema):
    production_order_id: UUID
    component: str
    source_type: str = "manual"
    source_id: str = ""
    amount: Decimal
    allocation_basis: str = "manual"


class ProductionCostResponse(Schema):
    id: UUID
    production_order_id: UUID
    order_number: str
    component: str
    source_type: str
    source_id: str
    amount: Decimal
    allocation_basis: str


def _production_cost_response(cost: ProductionCost) -> dict:
    return {
        "id": cost.id,
        "production_order_id": cost.production_order_id,
        "order_number": cost.production_order.order_number,
        "component": cost.component,
        "source_type": cost.source_type,
        "source_id": cost.source_id,
        "amount": cost.amount,
        "allocation_basis": cost.allocation_basis,
    }


@router.post("/hpp/estimate", response=HPPResponse)
def calculate_hpp_estimate(request: HttpRequest, payload: HPPEstimatePayload):
    context = require_capability(request, "production.hpp.estimate")
    variant = ProductVariant.objects.filter(
        tenant=context.tenant, id=payload.product_variant_id, is_active=True
    ).first()
    if variant is None:
        raise HttpError(404, "Varian produk tidak ditemukan")
    try:
        return estimate_hpp(
            tenant=request.tenant_context.tenant,
            product_variant=variant,
            quantity=payload.quantity,
            user=request.user,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.get("/costs", response=List[ProductionCostResponse])
def list_production_costs(
    request: HttpRequest, production_order_id: Optional[str] = None
):
    context = require_capability(request, "production.costs.read")
    qs = ProductionCost.objects.select_related("production_order").filter(
        tenant=context.tenant
    )
    if production_order_id:
        qs = qs.filter(production_order_id=production_order_id)
    return [_production_cost_response(cost) for cost in qs.order_by("-created_at")]


@router.post("/costs", response=ProductionCostResponse)
def create_production_cost(request: HttpRequest, payload: ProductionCostPayload):
    context = require_capability(request, "production.costs.create")
    if payload.amount <= 0:
        raise HttpError(422, "Nilai biaya produksi harus lebih besar dari nol")
    order = ProductionOrder.objects.filter(
        tenant=context.tenant, id=payload.production_order_id
    ).first()
    if order is None:
        raise HttpError(404, "Production Order tidak ditemukan")
    if order.status in {ProductionOrder.Status.COMPLETED, ProductionOrder.Status.CLOSED}:
        raise HttpError(422, "Biaya produksi tidak dapat ditambahkan ke SPK selesai")
    cost = ProductionCost.objects.create(
        tenant=context.tenant,
        production_order=order,
        component=payload.component,
        source_type=payload.source_type or "manual",
        source_id=payload.source_id or "",
        amount=payload.amount,
        allocation_basis=payload.allocation_basis or "manual",
    )
    record_audit(
        tenant=context.tenant,
        user=request.user,
        action="production_cost_created",
        resource_type="ProductionCost",
        resource_id=cost.id,
        after=model_snapshot(cost),
    )
    return _production_cost_response(
        ProductionCost.objects.select_related("production_order").get(pk=cost.pk)
    )


# --- Production Order ---
class ProductionOrderResponse(Schema):
    id: UUID
    order_number: str
    order_type: str
    sales_po_line_id: Optional[UUID] = None
    product_variant_id: UUID
    product_variant_sku: Optional[str] = None
    target_quantity: int
    status: str
    target_completion_date: Optional[date] = None


class MaterialRequirementResponse(Schema):
    id: UUID
    material_id: UUID
    source_bom_item_id: Optional[UUID] = None
    material_code: str
    material_name: str
    quantity_per_unit: Decimal
    usage_uom_code: str
    purchase_uom_code: str
    conversion_ratio: Decimal
    required_usage_qty: Decimal
    available_usage_qty: Decimal
    reserved_usage_qty: Decimal
    ordered_purchase_qty: Decimal
    shortage_usage_qty: Decimal
    recommended_purchase_qty: Decimal
    packaging_excess_usage_qty: Decimal
    calculation_version: int


class ProductionOrderDetailResponse(ProductionOrderResponse):
    material_requirements: List[MaterialRequirementResponse]


class ProductionOrderPayload(Schema):
    order_number: str = ""
    order_type: str
    sales_po_line_id: Optional[UUID] = None
    product_variant_id: UUID
    target_quantity: int
    status: str = "draft"
    target_completion_date: Optional[date] = None


def _production_order_response(order: ProductionOrder) -> dict:
    return {
        "id": order.id,
        "order_number": order.order_number,
        "order_type": order.order_type,
        "sales_po_line_id": order.sales_po_line_id,
        "product_variant_id": order.product_variant_id,
        "product_variant_sku": order.product_variant.sku
        if getattr(order, "product_variant", None)
        else None,
        "target_quantity": order.target_quantity,
        "status": order.status,
        "target_completion_date": order.target_completion_date,
    }


def _material_requirement_response(item: MaterialRequirement) -> dict:
    material = item.material
    return {
        "id": item.id,
        "material_id": item.material_id,
        "source_bom_item_id": item.source_bom_item_id,
        "material_code": item.material_code_snapshot or material.code,
        "material_name": item.material_name_snapshot or material.name,
        "quantity_per_unit": item.quantity_per_unit,
        "usage_uom_code": item.usage_uom_code_snapshot or material.usage_uom.code,
        "purchase_uom_code": item.purchase_uom_code_snapshot
        or material.purchase_uom.code,
        "conversion_ratio": item.conversion_ratio_snapshot or material.conversion_ratio,
        "required_usage_qty": item.required_usage_qty,
        "available_usage_qty": item.available_usage_qty,
        "reserved_usage_qty": item.reserved_usage_qty,
        "ordered_purchase_qty": item.ordered_purchase_qty,
        "shortage_usage_qty": item.shortage_usage_qty,
        "recommended_purchase_qty": item.recommended_purchase_qty,
        "packaging_excess_usage_qty": item.packaging_excess_usage_qty,
        "calculation_version": item.calculation_version,
    }


@router.get("/orders", response=List[ProductionOrderResponse])
def list_production_orders(request: HttpRequest):
    context = require_capability(request, "production.orders.read")
    orders = (
        ProductionOrder.objects.select_related("product_variant")
        .filter(tenant=context.tenant)
        .order_by("-created_at")
    )
    return [_production_order_response(order) for order in orders]


@router.get("/orders/{order_id}", response=ProductionOrderDetailResponse)
def get_production_order(request: HttpRequest, order_id: str):
    context = require_capability(request, "production.orders.read")
    order = (
        ProductionOrder.objects.select_related("product_variant")
        .filter(tenant=context.tenant, id=order_id)
        .first()
    )
    if order is None:
        raise HttpError(404, "Production Order tidak ditemukan")
    requirements = (
        MaterialRequirement.objects.select_related(
            "material", "material__usage_uom", "material__purchase_uom"
        )
        .filter(tenant=context.tenant, production_order=order)
        .order_by("material__code")
    )
    return {
        **_production_order_response(order),
        "material_requirements": [
            _material_requirement_response(item) for item in requirements
        ],
    }


@router.post("/orders", response=ProductionOrderResponse)
def create_production_order(request: HttpRequest, payload: ProductionOrderPayload):
    context = require_capability(request, "production.orders.create")
    tenant = context.tenant
    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number=next_document_number(tenant, "PROD"),
        status=ProductionOrder.Status.DRAFT,
        **payload.dict(exclude={"order_number", "status"}),
    )
    try:
        snapshot_material_requirements_from_bom(order, user=request.user)
    except ValueError as exc:
        order.delete()
        raise HttpError(422, str(exc)) from exc
    return _production_order_response(
        ProductionOrder.objects.select_related("product_variant").get(pk=order.pk)
    )


class FromSalesLinePayload(Schema):
    sales_po_line_id: UUID
    target_quantity: int
    target_completion_date: Optional[date] = None


@router.post("/orders/from-sales-line", response=ProductionOrderResponse)
def create_order_from_sales_line(request: HttpRequest, payload: FromSalesLinePayload):
    context = require_capability(request, "production.orders.create")
    sales_line = SalesPOLine.objects.filter(
        id=payload.sales_po_line_id, tenant=context.tenant
    ).first()
    if not sales_line:
        raise HttpError(404, "Sales PO Line tidak ditemukan")

    try:
        order = create_production_order_from_sales_po_line(
            sales_po_line=sales_line,
            target_quantity=payload.target_quantity,
            target_completion_date=payload.target_completion_date,
            user=request.user,
        )
        return _production_order_response(
            ProductionOrder.objects.select_related("product_variant").get(pk=order.pk)
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.put("/orders/{order_id}", response=ProductionOrderResponse)
def update_production_order(
    request: HttpRequest, order_id: str, payload: ProductionOrderPayload
):
    context = require_capability(request, "production.orders.update")
    order = ProductionOrder.objects.filter(
        id=order_id,
        tenant=context.tenant,
    ).first()
    if not order:
        raise HttpError(404, "Data tidak ditemukan")
    if order.status not in {
        ProductionOrder.Status.DRAFT,
        ProductionOrder.Status.PLANNED,
    }:
        raise HttpError(
            422, "Production Order yang sudah dirilis tidak dapat diedit langsung"
        )
    before_variant_id = order.product_variant_id
    for attr, value in payload.dict(exclude={"order_number", "status"}).items():
        setattr(order, attr, value)
    order.save()
    try:
        if order.product_variant_id != before_variant_id:
            snapshot_material_requirements_from_bom(order, user=request.user)
        else:
            recalculate_material_requirements(order)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return _production_order_response(
        ProductionOrder.objects.select_related("product_variant").get(pk=order.pk)
    )


# --- Job Packet ---
class JobPacketResponse(Schema):
    id: UUID
    production_order_id: str
    packet_number: str
    quantity: int
    current_stage_id: Optional[str] = None
    current_stage_name: Optional[str] = None
    assigned_operator_id: Optional[str] = None
    status: str


class JobPacketPayload(Schema):
    production_order_id: str
    packet_number: str
    quantity: int
    current_stage_id: Optional[str] = None
    assigned_operator_id: Optional[str] = None
    external_supplier_id: Optional[str] = None


def _job_packet_payload(item: JobPacket) -> dict:
    return {
        "id": item.id,
        "production_order_id": str(item.production_order_id),
        "packet_number": item.packet_number,
        "quantity": item.quantity,
        "current_stage_id": str(item.current_stage_id)
        if item.current_stage_id
        else None,
        "current_stage_name": item.current_stage.stage_name
        if item.current_stage_id
        else None,
        "assigned_operator_id": str(item.assigned_operator_id)
        if item.assigned_operator_id
        else None,
        "status": item.status,
    }


@router.get("/job-packets", response=List[JobPacketResponse])
def list_job_packets(request: HttpRequest, production_order_id: Optional[str] = None):
    context = require_any_capability(
        request,
        {"production.job_packets.read", "production.job_packets.assigned.read"},
    )
    qs = JobPacket.objects.select_related("current_stage").filter(tenant=context.tenant)
    if context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        qs = qs.filter(assigned_operator=operator_context.operator)
    if production_order_id:
        qs = qs.filter(production_order_id=production_order_id)
    return [_job_packet_payload(item) for item in qs.order_by("packet_number")]


@router.post("/job-packets", response=JobPacketResponse)
def create_job_packet(request: HttpRequest, payload: JobPacketPayload):
    context = require_capability(request, "production.job_packets.create")
    tenant_id = context.tenant_id
    order = ProductionOrder.objects.filter(
        id=payload.production_order_id, tenant_id=tenant_id
    ).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")
    packet = JobPacket.objects.create(tenant_id=tenant_id, **payload.dict())
    packet = JobPacket.objects.select_related("current_stage").get(id=packet.id)
    return _job_packet_payload(packet)


# --- Production Stage Progress ---
class ProductionStageProgressResponse(Schema):
    id: UUID
    job_packet_id: UUID
    stage_id: UUID
    operator_id: UUID
    qty_in: int
    qty_good: int
    qty_defect: int
    qty_rework: int
    qty_scrap: int
    qty_remaining: int
    is_verified: bool


class ProductionStageProgressPayload(Schema):
    job_packet_id: str
    stage_id: str
    operator_id: str
    qty_in: int = 0
    qty_good: int = 0
    qty_defect: int = 0
    qty_rework: int = 0
    qty_scrap: int = 0
    qty_remaining: int = 0
    defect_type: str = ""
    duration_minutes: int = 0


@router.post("/progress", response=ProductionStageProgressResponse)
def create_stage_progress(
    request: HttpRequest, payload: ProductionStageProgressPayload
):
    context = require_any_capability(
        request,
        {"production.progress.create", "production.progress.submit.assigned"},
    )
    tenant_id = context.tenant_id
    packet = JobPacket.objects.filter(
        id=payload.job_packet_id, tenant_id=tenant_id
    ).first()
    if not packet:
        raise HttpError(404, "Job Packet tidak ditemukan")
    operator_id = payload.operator_id
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        require_assigned_operator(packet, operator_context.operator)
        stage = RoutingStage.objects.filter(
            tenant_id=tenant_id, id=payload.stage_id
        ).first()
        if stage is None:
            raise HttpError(404, "Tahap produksi tidak ditemukan")
        if not operator_can_submit_stage(operator_context.operator, stage):
            raise HttpError(403, "Operator tidak dapat submit tahap produksi ini")
        operator_id = str(operator_context.operator.id)
    try:
        return submit_stage_progress(
            packet=packet,
            stage_id=payload.stage_id,
            operator_id=operator_id,
            qty_in=payload.qty_in,
            qty_good=payload.qty_good,
            qty_defect=payload.qty_defect,
            qty_rework=payload.qty_rework,
            qty_scrap=payload.qty_scrap,
            qty_remaining=payload.qty_remaining,
            defect_type=payload.defect_type,
            duration_minutes=payload.duration_minutes,
            user=request.user,
        )
    except PermissionError as exc:
        raise HttpError(403, str(exc)) from exc
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/release", response=ProductionOrderResponse)
def release_order(request: HttpRequest, order_id: str):
    context = require_capability(request, "production.orders.release")
    order = ProductionOrder.objects.filter(tenant=context.tenant, id=order_id).first()
    if order is None:
        raise HttpError(404, "Production Order tidak ditemukan")
    try:
        released = release_production_order(order, user=request.user)
        return _production_order_response(
            ProductionOrder.objects.select_related("product_variant").get(
                pk=released.pk
            )
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ProductionCompletePayload(Schema):
    output_quantity: int
    lot_number: str


@router.post("/orders/{order_id}/complete", response=ProductionOrderResponse)
def complete_order(
    request: HttpRequest, order_id: str, payload: ProductionCompletePayload
):
    context = require_capability(request, "production.orders.complete")
    order = ProductionOrder.objects.filter(tenant=context.tenant, id=order_id).first()
    if order is None:
        raise HttpError(404, "Production Order tidak ditemukan")
    try:
        completed, _batch, _hpp = complete_production_order(
            order,
            output_quantity=payload.output_quantity,
            lot_number=payload.lot_number,
            user=request.user,
        )
        return _production_order_response(
            ProductionOrder.objects.select_related("product_variant").get(
                pk=completed.pk
            )
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ProgressVerificationPayload(Schema):
    reason: str = ""
    correction: Optional[dict] = None


@router.post("/progress/{progress_id}/verify", response=ProductionStageProgressResponse)
def verify_progress(
    request: HttpRequest, progress_id: str, payload: ProgressVerificationPayload
):
    context = require_capability(request, "production.progress.verify")
    progress = ProductionStageProgress.objects.filter(
        tenant=context.tenant, id=progress_id
    ).first()
    if progress is None:
        raise HttpError(404, "Progres tidak ditemukan")
    try:
        return verify_stage_progress(
            progress,
            user=request.user,
            correction=payload.correction,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ReworkResponse(Schema):
    id: UUID
    source_progress_id: UUID
    target_stage_id: UUID
    operator_id: UUID
    quantity: int
    result_good: int
    result_scrap: int
    status: str


class ReworkCompletePayload(Schema):
    result_good: int
    result_scrap: int


@router.get("/rework", response=list[ReworkResponse])
def list_rework(request: HttpRequest):
    context = require_any_capability(
        request,
        {"production.rework.read", "production.rework.assigned.complete"},
    )
    queryset = ReworkOrder.objects.filter(tenant=context.tenant)
    if context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        queryset = queryset.filter(operator=operator_context.operator)
    return list(queryset.order_by("-created_at"))


@router.post("/rework/{rework_id}/complete", response=ReworkResponse)
def finish_rework(
    request: HttpRequest, rework_id: UUID, payload: ReworkCompletePayload
):
    context = require_any_capability(
        request,
        {"production.rework.complete", "production.rework.assigned.complete"},
    )
    rework = ReworkOrder.objects.filter(tenant=context.tenant, id=rework_id).first()
    if rework is None:
        raise HttpError(404, "Rework tidak ditemukan")
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        if str(rework.operator_id) != str(operator_context.operator.id):
            raise HttpError(403, "Rework tidak ditugaskan kepada operator ini")
    try:
        return complete_rework(rework, user=request.user, **payload.dict())
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ScrapResponse(Schema):
    id: UUID
    production_order_id: str
    source_progress_id: Optional[str] = None
    quantity: Decimal
    value: Decimal
    reason: str
    responsible_operator_id: Optional[str] = None
    approved_by_id: Optional[str] = None
    approval_id: Optional[str] = None


@router.get("/scrap", response=list[ScrapResponse])
def list_scrap(request: HttpRequest):
    context = require_capability(request, "production.scrap.read")
    return list(
        ScrapRecord.objects.filter(tenant=context.tenant).order_by("-created_at")
    )


@router.post("/scrap/{scrap_id}/approve", response=ScrapResponse)
def approve_scrap_record(request: HttpRequest, scrap_id: UUID):
    context = require_capability(request, "production.scrap.approve")
    scrap = ScrapRecord.objects.filter(tenant=context.tenant, id=scrap_id).first()
    if scrap is None:
        raise HttpError(404, "Scrap tidak ditemukan")
    try:
        return approve_scrap(scrap, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/mrp/recalculate")
def recalculate_mrp(request: HttpRequest, order_id: str):
    context = require_capability(request, "production.orders.recalculate_mrp")
    order = ProductionOrder.objects.filter(tenant=context.tenant, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")

    try:
        reqs = recalculate_material_requirements(order)
        return {"status": "ok", "requirements_count": len(reqs)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/materials/reserve")
def reserve_materials(request: HttpRequest, order_id: str):
    context = require_capability(request, "production.orders.reserve_materials")
    order = ProductionOrder.objects.filter(tenant=context.tenant, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")

    try:
        res = reserve_materials_for_order(order, user=request.user)
        return {"status": "ok", "reservations_count": len(res)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/purchase-requests/generate")
def generate_prs(request: HttpRequest, order_id: str):
    context = require_capability(
        request, "production.orders.generate_purchase_requests"
    )
    order = ProductionOrder.objects.filter(tenant=context.tenant, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")

    try:
        prs = generate_purchase_requests_from_requirements(order, user=request.user)
        return {"status": "ok", "purchase_requests_count": len(prs)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/materials/issue")
def issue_materials(request: HttpRequest, order_id: str):
    context = require_capability(request, "production.orders.issue_materials")
    order = ProductionOrder.objects.filter(tenant=context.tenant, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")

    try:
        cons = issue_materials_to_production(order, user=request.user)
        return {"status": "ok", "consumptions_count": len(cons)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/job-packets/{packet_id}/accept")
def accept_job_packet(request: HttpRequest, packet_id: str):
    context = require_any_capability(
        request,
        {"production.job_packets.accept", "production.job_packets.assigned.read"},
    )
    packet = JobPacket.objects.filter(id=packet_id, tenant=context.tenant).first()
    if not packet:
        raise HttpError(404, "Job Packet tidak ditemukan")

    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        require_assigned_operator(packet, operator_context.operator)

    if packet.status != JobPacket.Status.ASSIGNED:
        raise HttpError(422, "Hanya paket yang ditugaskan yang dapat diterima.")

    packet.status = JobPacket.Status.ACCEPTED
    packet.save(update_fields=["status", "updated_at"])
    return {"status": packet.status}


class RateAdjustPayload(Schema):
    new_rate: Decimal
    reason: str


@router.post("/work-logs/{log_id}/adjust-rate")
def adjust_work_log_rate(request: HttpRequest, log_id: str, payload: RateAdjustPayload):
    context = require_capability(request, "production.work_logs.adjust_rate")
    log = OperatorWorkLog.objects.filter(tenant=context.tenant, id=log_id).first()
    if not log:
        raise HttpError(404, "Work Log tidak ditemukan")

    try:
        updated = adjust_operator_work_log_rate(
            log, user=request.user, new_rate=payload.new_rate, reason=payload.reason
        )
        return {"status": "ok", "new_amount": str(updated.amount_total)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class PaymentRequestBatchPayload(Schema):
    work_log_ids: list[str]
    due_date: Optional[date] = None


@router.post("/work-logs/payment-request")
def create_work_log_payment(request: HttpRequest, payload: PaymentRequestBatchPayload):
    require_capability(request, "production.work_logs.payment_request")
    try:
        pr = create_operator_payment_request(
            payload.work_log_ids, user=request.user, due_date=payload.due_date
        )
        return {"status": "ok", "payment_request_id": str(pr.id)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class WorkLogResponse(Schema):
    id: str
    operator_id: str
    qty_claimed: int
    piece_rate_applied: Decimal
    amount_total: Decimal
    is_paid: bool
    is_verified: bool
    rate_adjustment_reason: str


@router.get("/work-logs", response=list[WorkLogResponse])
def list_work_logs(
    request: HttpRequest,
    is_verified: Optional[bool] = None,
    is_paid: Optional[bool] = None,
    operator_id: Optional[str] = None,
):
    context = require_capability(request, "production.work_logs.read")
    qs = OperatorWorkLog.objects.filter(tenant=context.tenant)
    if is_verified is not None:
        qs = qs.filter(is_verified=is_verified)
    if is_paid is not None:
        qs = qs.filter(is_paid=is_paid)
    if operator_id:
        qs = qs.filter(operator_id=operator_id)

    return [
        {
            "id": str(log.id),
            "operator_id": str(log.operator_id),
            "qty_claimed": log.qty_claimed,
            "piece_rate_applied": log.piece_rate_applied,
            "amount_total": log.amount_total,
            "is_paid": log.is_paid,
            "is_verified": log.is_verified,
            "rate_adjustment_reason": log.rate_adjustment_reason,
        }
        for log in qs.order_by("-created_at")
    ]
