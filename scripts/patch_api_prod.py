with open("backend/api/production.py", "r") as f:
    content = f.read()

# Add imports for services
content = content.replace(
    "from backend.production.services import (",
    "from backend.production.services import (\n    create_production_order_from_sales_po_line,\n    reserve_materials_for_order,\n    generate_purchase_requests_from_requirements,\n    issue_materials_to_production,\n    adjust_operator_work_log_rate,\n    create_operator_payment_request,\n    recalculate_material_requirements,",
)

# Also need OperatorWorkLog
content = content.replace(
    "from backend.production.models import (",
    "from backend.production.models import (\n    OperatorWorkLog,",
)

# Also need SalesPOLine
if "SalesPOLine" not in content:
    content = content.replace(
        "from backend.sales.models import ",
        "from backend.sales.models import SalesPOLine, ",
    )
else:
    # already there or no import at all?
    if "backend.sales.models" not in content:
        content = content.replace(
            "from backend.production.models import",
            "from backend.sales.models import SalesPOLine\nfrom backend.production.models import",
        )

new_endpoints = """

class FromSalesLinePayload(Schema):
    sales_po_line_id: str
    target_quantity: int
    target_completion_date: Optional[date] = None

@router.post("/orders/from-sales-line", response=ProductionOrderResponse)
def create_order_from_sales_line(request: HttpRequest, payload: FromSalesLinePayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    sales_line = SalesPOLine.objects.filter(id=payload.sales_po_line_id, tenant_id=tenant_id).first()
    if not sales_line:
        raise HttpError(404, "Sales PO Line tidak ditemukan")
        
    try:
        return create_production_order_from_sales_po_line(
            sales_po_line=sales_line,
            target_quantity=payload.target_quantity,
            target_completion_date=payload.target_completion_date,
            user=request.user
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/mrp/recalculate")
def recalculate_mrp(request: HttpRequest, order_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    order = ProductionOrder.objects.filter(tenant_id=tenant_id, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")
        
    try:
        reqs = recalculate_material_requirements(order)
        return {"status": "ok", "requirements_count": len(reqs)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/materials/reserve")
def reserve_materials(request: HttpRequest, order_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    order = ProductionOrder.objects.filter(tenant_id=tenant_id, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")
        
    try:
        res = reserve_materials_for_order(order, user=request.user)
        return {"status": "ok", "reservations_count": len(res)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/purchase-requests/generate")
def generate_prs(request: HttpRequest, order_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    order = ProductionOrder.objects.filter(tenant_id=tenant_id, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")
        
    try:
        prs = generate_purchase_requests_from_requirements(order, user=request.user)
        return {"status": "ok", "purchase_requests_count": len(prs)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{order_id}/materials/issue")
def issue_materials(request: HttpRequest, order_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    order = ProductionOrder.objects.filter(tenant_id=tenant_id, id=order_id).first()
    if not order:
        raise HttpError(404, "Production Order tidak ditemukan")
        
    try:
        cons = issue_materials_to_production(order, user=request.user)
        return {"status": "ok", "consumptions_count": len(cons)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/job-packets/{packet_id}/accept")
def accept_job_packet(request: HttpRequest, packet_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_OPERATIONAL)
    packet = JobPacket.objects.filter(id=packet_id, tenant_id=tenant_id).first()
    if not packet:
        raise HttpError(404, "Job Packet tidak ditemukan")
        
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        require_assigned_operator(packet, operator_context.operator)
        
    if packet.status != JobPacket.Status.PLANNED:
        raise HttpError(422, "Hanya paket terencana yang dapat diterima.")
        
    packet.status = JobPacket.Status.IN_PROGRESS
    packet.save(update_fields=["status", "updated_at"])
    return {"status": packet.status}


class RateAdjustPayload(Schema):
    new_rate: Decimal
    reason: str


@router.post("/work-logs/{log_id}/adjust-rate")
def adjust_work_log_rate(request: HttpRequest, log_id: str, payload: RateAdjustPayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    log = OperatorWorkLog.objects.filter(tenant_id=tenant_id, id=log_id).first()
    if not log:
        raise HttpError(404, "Work Log tidak ditemukan")
        
    try:
        updated = adjust_operator_work_log_rate(log, user=request.user, new_rate=payload.new_rate, reason=payload.reason)
        return {"status": "ok", "new_amount": str(updated.amount_total)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class PaymentRequestBatchPayload(Schema):
    work_log_ids: list[str]
    due_date: Optional[date] = None


@router.post("/work-logs/payment-request")
def create_work_log_payment(request: HttpRequest, payload: PaymentRequestBatchPayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    try:
        pr = create_operator_payment_request(payload.work_log_ids, user=request.user, due_date=payload.due_date)
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
def list_work_logs(request: HttpRequest, is_verified: Optional[bool] = None, is_paid: Optional[bool] = None, operator_id: Optional[str] = None):
    tenant_id = get_tenant_id(request, allowed_roles=PRODUCTION_READ_ROLES)
    qs = OperatorWorkLog.objects.filter(tenant_id=tenant_id)
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

"""

with open("backend/api/production.py", "w") as f:
    f.write(content + new_endpoints)
