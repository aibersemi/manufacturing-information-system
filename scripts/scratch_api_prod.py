from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import (
    ROLE_FINANCE,
    ROLE_OPERATOR,
    ROLES_MANAGEMENT,
    ROLES_OPERATIONAL,
    get_tenant_context,
    get_tenant_id,
    tenant_session_auth,
)
from backend.core.capabilities import (
    operator_can_submit_stage,
    require_assigned_operator,
    require_operator_context,
)
from backend.core.models import Tenant
from backend.core.services import next_document_number
from backend.masterdata.models import ProductVariant, RoutingStage
from backend.production.models import (
    JobPacket,
    ProductionOrder,
    ProductionStageProgress,
    ReworkOrder,
    ScrapRecord,
)
from backend.production.services import (
    approve_scrap,
    complete_production_order,
    complete_rework,
    estimate_hpp,
    release_production_order,
    submit_stage_progress,
    verify_stage_progress,
)

PRODUCTION_READ_ROLES = frozenset({*ROLES_MANAGEMENT, ROLE_FINANCE})

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


@router.post("/hpp/estimate", response=HPPResponse)
def calculate_hpp_estimate(request: HttpRequest, payload: HPPEstimatePayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    variant = ProductVariant.objects.filter(
        tenant_id=tenant_id, id=payload.product_variant_id, is_active=True
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


# --- Production Order ---
class ProductionOrderResponse(Schema):
    id: UUID
    order_number: str
    order_type: str
    sales_po_line_id: Optional[str] = None
    product_variant_id: UUID
    target_quantity: int
    status: str
    target_completion_date: Optional[date] = None


class ProductionOrderPayload(Schema):
    order_number: str = ""
    order_type: str
    sales_po_line_id: Optional[str] = None
    product_variant_id: UUID
    target_quantity: int
    status: str = "draft"
    target_completion_date: Optional[date] = None


@router.get("/orders", response=List[ProductionOrderResponse])
def list_production_orders(request: HttpRequest):
    return list(
        ProductionOrder.objects.filter(
            tenant_id=get_tenant_id(request, allowed_roles=PRODUCTION_READ_ROLES)
        ).order_by("-created_at")
    )


@router.post("/orders", response=ProductionOrderResponse)
def create_production_order(request: HttpRequest, payload: ProductionOrderPayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    tenant = Tenant.objects.get(id=tenant_id)
    return ProductionOrder.objects.create(
        tenant=tenant,
        order_number=next_document_number(tenant, "PROD"),
        status=ProductionOrder.Status.DRAFT,
        **payload.dict(exclude={"order_number", "status"}),
    )


@router.put("/orders/{order_id}", response=ProductionOrderResponse)
def update_production_order(
    request: HttpRequest, order_id: str, payload: ProductionOrderPayload
):
    order = ProductionOrder.objects.filter(
        id=order_id,
        tenant_id=get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT),
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
    for attr, value in payload.dict(exclude={"order_number", "status"}).items():
        setattr(order, attr, value)
    order.save()
    return order


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
    context = get_tenant_context(
        request, allowed_roles=frozenset({*PRODUCTION_READ_ROLES, ROLE_OPERATOR})
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
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
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
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_OPERATIONAL)
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
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    order = ProductionOrder.objects.filter(tenant_id=tenant_id, id=order_id).first()
    if order is None:
        raise HttpError(404, "Production Order tidak ditemukan")
    try:
        return release_production_order(order, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ProductionCompletePayload(Schema):
    output_quantity: int
    lot_number: str


@router.post("/orders/{order_id}/complete", response=ProductionOrderResponse)
def complete_order(
    request: HttpRequest, order_id: str, payload: ProductionCompletePayload
):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    order = ProductionOrder.objects.filter(tenant_id=tenant_id, id=order_id).first()
    if order is None:
        raise HttpError(404, "Production Order tidak ditemukan")
    try:
        completed, _batch, _hpp = complete_production_order(
            order,
            output_quantity=payload.output_quantity,
            lot_number=payload.lot_number,
            user=request.user,
        )
        return completed
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ProgressVerificationPayload(Schema):
    reason: str = ""
    correction: Optional[dict] = None


@router.post("/progress/{progress_id}/verify", response=ProductionStageProgressResponse)
def verify_progress(
    request: HttpRequest, progress_id: str, payload: ProgressVerificationPayload
):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    progress = ProductionStageProgress.objects.filter(
        tenant_id=tenant_id, id=progress_id
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
    context = get_tenant_context(
        request, allowed_roles=frozenset({*PRODUCTION_READ_ROLES, ROLE_OPERATOR})
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
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_OPERATIONAL)
    rework = ReworkOrder.objects.filter(tenant_id=tenant_id, id=rework_id).first()
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
    tenant_id = get_tenant_id(request, allowed_roles=PRODUCTION_READ_ROLES)
    return list(ScrapRecord.objects.filter(tenant_id=tenant_id).order_by("-created_at"))


@router.post("/scrap/{scrap_id}/approve", response=ScrapResponse)
def approve_scrap_record(request: HttpRequest, scrap_id: UUID):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    scrap = ScrapRecord.objects.filter(tenant_id=tenant_id, id=scrap_id).first()
    if scrap is None:
        raise HttpError(404, "Scrap tidak ditemukan")
    try:
        return approve_scrap(scrap, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
