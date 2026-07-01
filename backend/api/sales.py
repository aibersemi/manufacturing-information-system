from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from django.db.models.deletion import ProtectedError, RestrictedError
from django.http import HttpRequest
from ninja import Router, Schema, Status
from ninja.errors import HttpError

from backend.core.access import require_capability, tenant_session_auth
from backend.core.models import Tenant
from backend.core.services import next_document_number
from backend.sales.models import Delivery, SalesPO, SalesPOLine
from backend.sales.services import (
    close_delivery,
    create_delivery,
    fulfillment_recommendation,
    plan_fulfillment,
    receive_sales_return,
    revise_sales_po,
    short_close_sales_po,
)

router = Router(tags=["Sales"], auth=tenant_session_auth)


class DetailResponse(Schema):
    detail: str


# --- Sales PO ---
class SalesPOResponse(Schema):
    id: UUID
    customer_id: UUID
    po_number: str
    order_date: date
    due_date: Optional[date] = None
    status: str
    is_locked: bool
    version: int
    notes: str


class SalesPOPayload(Schema):
    customer_id: str
    po_number: str = ""
    order_date: date
    due_date: Optional[date] = None
    status: str = "draft"
    notes: str = ""


@router.get("/orders", response=List[SalesPOResponse])
def list_sales_orders(request: HttpRequest):
    context = require_capability(request, "sales.orders.read")
    return list(
        SalesPO.objects.filter(tenant=context.tenant).order_by(
            "-order_date", "-created_at"
        )
    )


@router.post("/orders", response=SalesPOResponse)
def create_sales_order(request: HttpRequest, payload: SalesPOPayload):
    context = require_capability(request, "sales.orders.create")
    tenant = context.tenant
    data = payload.dict(exclude={"po_number", "status"})
    return SalesPO.objects.create(
        tenant=tenant,
        po_number=next_document_number(tenant, "PO", at=payload.order_date),
        status=SalesPO.Status.DRAFT,
        **data,
    )


@router.put("/orders/{uuid:po_id}", response=SalesPOResponse)
def update_sales_order(request: HttpRequest, po_id: UUID, payload: SalesPOPayload):
    context = require_capability(request, "sales.orders.update")
    po = SalesPO.objects.filter(
        id=po_id,
        tenant=context.tenant,
    ).first()
    if not po:
        raise HttpError(404, "Data tidak ditemukan")
    try:
        return revise_sales_po(
            po,
            user=request.user,
            reason=payload.notes or "Revisi melalui API",
            changes=payload.dict(exclude={"po_number", "status"}),
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.delete(
    "/orders/{uuid:po_id}", response={200: DetailResponse, 409: DetailResponse}
)
def delete_sales_order(request: HttpRequest, po_id: UUID):
    context = require_capability(request, "sales.orders.delete")
    po = SalesPO.objects.filter(
        id=po_id,
        tenant=context.tenant,
    ).first()
    if not po:
        raise HttpError(404, "Data tidak ditemukan")
    if po.is_locked:
        return Status(409, {"detail": "PO sudah terkunci dan tidak dapat dihapus."})

    try:
        po.delete()
    except (ProtectedError, RestrictedError):
        return Status(
            409, {"detail": "Sales PO masih digunakan dan tidak dapat dihapus."}
        )
    return {"detail": "Sales PO berhasil dihapus."}


# --- Sales PO Line ---
class SalesPOLineResponse(Schema):
    id: UUID
    sales_po_id: UUID
    product_variant_id: UUID
    quantity: int
    unit_price: Decimal
    fulfilled_qty: int


class SalesPOLinePayload(Schema):
    sales_po_id: UUID
    product_variant_id: UUID
    quantity: int
    unit_price: Decimal


@router.get("/orders/{uuid:po_id}/lines", response=List[SalesPOLineResponse])
def list_sales_order_lines(request: HttpRequest, po_id: UUID):
    context = require_capability(request, "sales.orders.read")
    return list(
        SalesPOLine.objects.filter(
            sales_po_id=po_id,
            sales_po__tenant=context.tenant,
        )
    )


@router.post("/orders/lines", response=SalesPOLineResponse)
def create_sales_order_line(request: HttpRequest, payload: SalesPOLinePayload):
    context = require_capability(request, "sales.orders.create")
    tenant_id = context.tenant_id
    po = SalesPO.objects.filter(id=payload.sales_po_id, tenant_id=tenant_id).first()
    if not po:
        raise HttpError(404, "Sales PO tidak ditemukan")
    if po.is_locked:
        raise HttpError(400, "PO sudah terkunci")
    return SalesPOLine.objects.create(tenant_id=tenant_id, **payload.dict())


class FulfillmentPlanPayload(Schema):
    strategy: str
    allocations: List[dict] = []


class ShortClosePayload(Schema):
    reason: str
    evidence_id: str


@router.get("/orders/{uuid:po_id}/fulfillment")
def get_fulfillment_recommendation(request: HttpRequest, po_id: UUID):
    context = require_capability(request, "sales.orders.read")
    po = (
        SalesPO.objects.filter(tenant=context.tenant, id=po_id)
        .prefetch_related("lines")
        .first()
    )
    if po is None:
        raise HttpError(404, "PO tidak ditemukan")
    return [
        {"line_id": str(line.id), **fulfillment_recommendation(line)}
        for line in po.lines.all()
    ]


@router.post("/orders/{uuid:po_id}/fulfillment", response=SalesPOResponse)
def set_fulfillment_plan(
    request: HttpRequest, po_id: UUID, payload: FulfillmentPlanPayload
):
    context = require_capability(request, "sales.orders.fulfillment")
    po = SalesPO.objects.filter(tenant=context.tenant, id=po_id).first()
    if po is None:
        raise HttpError(404, "PO tidak ditemukan")
    try:
        return plan_fulfillment(
            po,
            strategy=payload.strategy,
            allocations=payload.allocations,
            user=request.user,
        )
    except (ValueError, SalesPOLine.DoesNotExist) as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/orders/{uuid:po_id}/short-close", response=SalesPOResponse)
def short_close_order(request: HttpRequest, po_id: UUID, payload: ShortClosePayload):
    context = require_capability(request, "sales.orders.short_close")
    po = SalesPO.objects.filter(tenant=context.tenant, id=po_id).first()
    if po is None:
        raise HttpError(404, "PO tidak ditemukan")
    try:
        return short_close_sales_po(
            po,
            user=request.user,
            reason=payload.reason,
            evidence_id=payload.evidence_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class DeliveryPayload(Schema):
    sales_po_id: str
    lines: List[dict]
    shipping_cost: Decimal = Decimal("0")
    shipping_payer: str = "customer"
    delivery_address: str


class DeliveryResponse(Schema):
    id: str
    sales_po_id: str
    delivery_number: str
    date: date
    status: str
    shipping_cost: Decimal
    shipping_payer: str
    receiver_name: Optional[str] = None
    received_time: Optional[datetime] = None


@router.post("/deliveries", response=DeliveryResponse)
def ship_delivery(request: HttpRequest, payload: DeliveryPayload):
    context = require_capability(request, "sales.deliveries.create")
    tenant = Tenant.objects.get(id=context.tenant_id)
    po = SalesPO.objects.filter(tenant=tenant, id=payload.sales_po_id).first()
    if po is None:
        raise HttpError(404, "PO tidak ditemukan")
    try:
        return create_delivery(
            tenant=tenant,
            sales_po=po,
            lines=payload.lines,
            shipping_cost=payload.shipping_cost,
            shipping_payer=payload.shipping_payer,
            address=payload.delivery_address,
            user=request.user,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class DeliveryClosePayload(Schema):
    receiver_name: str
    received_time: datetime
    proof_id: Optional[str] = None


@router.post("/deliveries/{delivery_id}/close", response=DeliveryResponse)
def confirm_delivery(
    request: HttpRequest, delivery_id: str, payload: DeliveryClosePayload
):
    context = require_capability(request, "sales.deliveries.close")
    delivery = Delivery.objects.filter(tenant=context.tenant, id=delivery_id).first()
    if delivery is None:
        raise HttpError(404, "Pengiriman tidak ditemukan")
    try:
        return close_delivery(
            delivery,
            receiver_name=payload.receiver_name,
            received_time=payload.received_time,
            proof_id=payload.proof_id,
            user=request.user,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


class ReturnPayload(Schema):
    delivery_id: str
    reason: str
    condition: str
    lines: List[dict]


@router.post("/returns")
def create_return(request: HttpRequest, payload: ReturnPayload):
    context = require_capability(request, "sales.returns.create")
    delivery = Delivery.objects.filter(
        tenant=context.tenant, id=payload.delivery_id
    ).first()
    if delivery is None:
        raise HttpError(404, "Pengiriman tidak ditemukan")
    try:
        sales_return = receive_sales_return(
            delivery=delivery,
            return_lines=payload.lines,
            reason=payload.reason,
            condition=payload.condition,
            user=request.user,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {"id": str(sales_return.id), "return_number": sales_return.return_number}
