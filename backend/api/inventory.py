from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from django.db import transaction
from django.db.models import F
from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import require_capability, tenant_session_auth
from backend.core.services import next_document_number
from backend.inventory.models import (
    MaterialLedger,
    MaterialReceipt,
    MaterialReceiptLine,
    ProductBatch,
    ProductLedger,
    PurchaseOrder,
    PurchaseOrderLine,
    StockAdjustment,
    PurchaseRequest,
)
from backend.inventory.services import (
    confirm_purchase_order,
    cancel_purchase_order,
    approve_and_post_stock_adjustment,
    material_balance,
    moving_average_cost,
    product_category_balance,
    record_material_movement,
    request_stock_adjustment,
)
from backend.masterdata.models import Material
from backend.production.models import ProductionOrder

router = Router(tags=["Inventory"], auth=tenant_session_auth)


# --- Material Ledger ---
class MaterialLedgerResponse(Schema):
    id: UUID
    material_id: UUID
    transaction_type: str
    quantity: Decimal
    unit_cost: Decimal
    reference_document: str
    notes: str
    created_at: datetime


@router.get("/material-ledger", response=List[MaterialLedgerResponse])
def list_material_ledger(request: HttpRequest, material_id: Optional[str] = None):
    context = require_capability(request, "inventory.material_ledger.read")
    qs = MaterialLedger.objects.filter(tenant=context.tenant)
    if material_id:
        qs = qs.filter(material_id=material_id)
    return list(qs.order_by("-created_at"))


# --- Product Ledger ---
class ProductLedgerResponse(Schema):
    id: UUID
    product_variant_id: UUID
    transaction_type: str
    quantity: int
    batch_lot_number: str
    unit_cost: Decimal
    reference_document: str


@router.get("/product-ledger", response=List[ProductLedgerResponse])
def list_product_ledger(request: HttpRequest, product_variant_id: Optional[str] = None):
    context = require_capability(request, "inventory.product_ledger.read")
    qs = ProductLedger.objects.filter(tenant=context.tenant)
    if product_variant_id:
        qs = qs.filter(product_variant_id=product_variant_id)
    return list(qs.order_by("-created_at"))


# --- Purchase Request ---
class PurchaseRequestResponse(Schema):
    id: UUID
    pr_number: str
    material_id: UUID
    requested_qty: Decimal
    status: str
    production_order_id: Optional[UUID]


class PurchaseRequestPayload(Schema):
    material_id: UUID
    requested_qty: Decimal
    production_order_id: Optional[UUID] = None


def _validate_purchase_quantity(material: Material, quantity: Decimal) -> None:
    if quantity <= 0:
        raise HttpError(422, "Kuantitas pembelian harus lebih besar dari nol")
    if quantity < material.moq:
        raise HttpError(
            422,
            (
                f"Kuantitas {material.name} kurang dari MOQ "
                f"{material.moq} {material.purchase_uom.code}"
            ),
        )
    multiple = material.purchase_multiple or Decimal("1")
    if multiple > 0 and quantity % multiple != 0:
        raise HttpError(
            422,
            (
                f"Kuantitas {material.name} harus kelipatan "
                f"{multiple} {material.purchase_uom.code}"
            ),
        )


@router.get("/purchase-requests", response=List[PurchaseRequestResponse])
def list_purchase_requests(request: HttpRequest):
    context = require_capability(request, "inventory.purchase_requests.read")
    return list(
        PurchaseRequest.objects.filter(tenant=context.tenant).order_by("-created_at")
    )


@router.post("/purchase-requests", response=PurchaseRequestResponse)
def create_purchase_request(request: HttpRequest, payload: PurchaseRequestPayload):
    context = require_capability(request, "inventory.purchase_requests.create")
    tenant = context.tenant
    material = Material.objects.filter(tenant=tenant, id=payload.material_id).first()
    if material is None:
        raise HttpError(422, "Material pembelian tidak ditemukan")
    _validate_purchase_quantity(material, payload.requested_qty)
    with transaction.atomic():
        pr = PurchaseRequest.objects.create(
            tenant=tenant,
            pr_number=next_document_number(tenant, "REQ"),
            material_id=payload.material_id,
            requested_qty=payload.requested_qty,
            status=PurchaseRequest.Status.DRAFT,
            production_order_id=payload.production_order_id,
        )
        return pr


@router.post("/purchase-requests/{pr_id}/submit", response=PurchaseRequestResponse)
def submit_purchase_request(request: HttpRequest, pr_id: str):
    context = require_capability(request, "inventory.purchase_requests.submit")
    pr = PurchaseRequest.objects.filter(tenant=context.tenant, id=pr_id).first()
    if not pr:
        raise HttpError(404, "Purchase Request tidak ditemukan")
    if pr.status != PurchaseRequest.Status.DRAFT:
        raise HttpError(422, "Hanya PR draft yang dapat disubmit")
    pr.status = PurchaseRequest.Status.SUBMITTED
    pr.save(update_fields=["status", "updated_at"])
    return pr


# --- Purchase Order ---
class PurchaseOrderLineResponse(Schema):
    id: UUID
    material_id: UUID
    quantity: Decimal
    unit_price: Decimal
    received_qty: Decimal


class PurchaseOrderResponse(Schema):
    id: UUID
    po_number: str
    supplier_id: UUID
    status: str
    total_amount: Decimal
    lines: List[PurchaseOrderLineResponse]


class PurchaseOrderLinePayload(Schema):
    material_id: UUID
    quantity: Decimal
    unit_price: Decimal


class PurchaseOrderPayload(Schema):
    po_number: str = ""
    supplier_id: UUID
    status: str = "draft"
    total_amount: Decimal = Decimal("0")
    lines: List[PurchaseOrderLinePayload]


@router.get("/purchases", response=List[PurchaseOrderResponse])
def list_purchase_orders(request: HttpRequest):
    context = require_capability(request, "inventory.purchases.read")
    return list(
        PurchaseOrder.objects.filter(tenant=context.tenant)
        .prefetch_related("lines")
        .order_by("-created_at")
    )


@router.post("/purchases", response=PurchaseOrderResponse)
def create_purchase_order(request: HttpRequest, payload: PurchaseOrderPayload):
    context = require_capability(request, "inventory.purchases.create")
    tenant = context.tenant
    tenant_id = context.tenant_id
    with transaction.atomic():
        total_amount = sum(line.quantity * line.unit_price for line in payload.lines)
        po = PurchaseOrder.objects.create(
            tenant=tenant,
            po_number=next_document_number(tenant, "PUR"),
            supplier_id=payload.supplier_id,
            status=PurchaseOrder.Status.DRAFT,
            total_amount=total_amount,
        )

        for line_data in payload.lines:
            material = Material.objects.filter(
                tenant=tenant, id=line_data.material_id
            ).first()
            if material is None:
                raise HttpError(422, "Material pembelian tidak ditemukan")
            _validate_purchase_quantity(material, line_data.quantity)
            PurchaseOrderLine.objects.create(
                tenant_id=tenant_id,
                purchase_order=po,
                conversion_ratio_snapshot=material.conversion_ratio,
                **line_data.dict(),
            )
        return po


class MaterialBalanceResponse(Schema):
    material_id: UUID
    balance: Decimal
    moving_average_cost: Decimal


@router.get("/materials/{material_id}/balance", response=MaterialBalanceResponse)
def get_material_balance(request: HttpRequest, material_id: UUID):
    context = require_capability(request, "inventory.material_balance.read")
    tenant = context.tenant
    material = Material.objects.filter(tenant=tenant, id=material_id).first()
    if material is None:
        raise HttpError(404, "Material tidak ditemukan")
    return {
        "material_id": material.id,
        "balance": material_balance(tenant, material),
        "moving_average_cost": moving_average_cost(tenant, material),
    }


class MaterialMovementPayload(Schema):
    material_id: UUID
    transaction_type: str
    quantity: Decimal
    unit_cost: Decimal = Decimal("0")
    reference_document: str
    idempotency_key: str
    production_order_id: Optional[str] = None
    reason: str = ""
    notes: str = ""


@router.post("/material-ledger", response=MaterialLedgerResponse)
def create_material_movement(request: HttpRequest, payload: MaterialMovementPayload):
    context = require_capability(request, "inventory.material_ledger.create")
    tenant = context.tenant
    material = Material.objects.filter(tenant=tenant, id=payload.material_id).first()
    if material is None:
        raise HttpError(404, "Material tidak ditemukan")
    production_order = None
    if payload.production_order_id:
        production_order = ProductionOrder.objects.filter(
            tenant=tenant, id=payload.production_order_id
        ).first()
        if production_order is None:
            raise HttpError(404, "Production Order tidak ditemukan")
    try:
        return record_material_movement(
            tenant=tenant,
            material=material,
            transaction_type=payload.transaction_type,
            quantity=payload.quantity,
            unit_cost=payload.unit_cost,
            reference_document=payload.reference_document,
            user=request.user,
            idempotency_key=payload.idempotency_key,
            production_order=production_order,
            reason=payload.reason,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.get("/product-batches/{batch_id}/balance")
def get_product_batch_balance(request: HttpRequest, batch_id: UUID):
    context = require_capability(request, "inventory.product_batches.read")
    tenant = context.tenant
    batch = ProductBatch.objects.filter(tenant=tenant, id=batch_id).first()
    if batch is None:
        raise HttpError(404, "Batch tidak ditemukan")
    return {
        category: product_category_balance(tenant, batch, category)
        for category in ProductLedger.Category.values
    }


class ReceiptLinePayload(Schema):
    purchase_order_line_id: UUID
    received_qty: Decimal
    accepted_qty: Decimal
    rejected_qty: Decimal = Decimal("0")
    unit_cost: Decimal
    variance_reason: str = ""


class MaterialReceiptPayload(Schema):
    purchase_order_id: UUID
    receipt_date: date
    supplier_do_number: str = ""
    lines: List[ReceiptLinePayload]


@router.post("/receipts")
def receive_material(request: HttpRequest, payload: MaterialReceiptPayload):
    context = require_capability(request, "inventory.receipts.create")
    tenant = context.tenant
    po = PurchaseOrder.objects.filter(
        tenant=tenant, id=payload.purchase_order_id
    ).first()
    if po is None:
        raise HttpError(404, "Purchase Order tidak ditemukan")
    with transaction.atomic():
        receipt = MaterialReceipt.objects.create(
            tenant=tenant,
            purchase_order=po,
            receipt_number=next_document_number(tenant, "RCV", at=payload.receipt_date),
            receipt_date=payload.receipt_date,
            supplier_do_number=payload.supplier_do_number,
            received_by=request.user,
        )
        has_variance = False
        for item in payload.lines:
            line = (
                PurchaseOrderLine.objects.select_for_update()
                .filter(
                    tenant=tenant,
                    purchase_order=po,
                    id=item.purchase_order_line_id,
                )
                .first()
            )
            if line is None:
                raise HttpError(422, "Baris pembelian tidak ditemukan")
            if item.accepted_qty + item.rejected_qty != item.received_qty:
                raise HttpError(
                    422, "Qty diterima harus sama dengan diterima baik + ditolak"
                )
            if line.received_qty + item.accepted_qty > line.quantity:
                raise HttpError(422, "Penerimaan melebihi jumlah pesanan")
            variance = item.rejected_qty > 0 or item.received_qty != item.accepted_qty
            if variance and not item.variance_reason:
                raise HttpError(422, "Selisih penerimaan wajib memiliki alasan")
            MaterialReceiptLine.objects.create(
                tenant=tenant,
                receipt=receipt,
                purchase_order_line=line,
                received_qty=item.received_qty,
                accepted_qty=item.accepted_qty,
                rejected_qty=item.rejected_qty,
                unit_cost=item.unit_cost,
                variance_reason=item.variance_reason,
                reconciliation_status="variance" if variance else "matched",
            )
            record_material_movement(
                tenant=tenant,
                material=line.material,
                transaction_type=MaterialLedger.TransactionType.RECEIPT,
                quantity=item.accepted_qty * line.conversion_ratio_snapshot,
                unit_cost=item.unit_cost / line.conversion_ratio_snapshot,
                reference_document=receipt.receipt_number,
                user=request.user,
                idempotency_key=f"receipt:{receipt.id}:{line.id}",
            )
            line.received_qty += item.accepted_qty
            line.save(update_fields=["received_qty", "updated_at"])
            has_variance = has_variance or variance
        complete = not po.lines.filter(received_qty__lt=F("quantity")).exists()
        po.status = (
            PurchaseOrder.Status.COMPLETED
            if complete
            else PurchaseOrder.Status.PARTIAL_RECEIPT
        )
        po.reconciliation_status = (
            "variance" if has_variance else ("reconciled" if complete else "open")
        )
        po.save(update_fields=["status", "reconciliation_status", "updated_at"])
    return {"id": str(receipt.id), "receipt_number": receipt.receipt_number}


class StockAdjustmentPayload(Schema):
    material_id: UUID
    quantity: Decimal
    unit_cost: Decimal
    reason: str
    proof_id: Optional[str] = None


@router.post("/stock-adjustments")
def create_stock_adjustment(request: HttpRequest, payload: StockAdjustmentPayload):
    context = require_capability(request, "inventory.stock_adjustments.create")
    tenant = context.tenant
    material = Material.objects.filter(tenant=tenant, id=payload.material_id).first()
    if material is None:
        raise HttpError(404, "Material tidak ditemukan")
    try:
        adjustment = request_stock_adjustment(
            tenant=tenant,
            material=material,
            quantity=payload.quantity,
            unit_cost=payload.unit_cost,
            reason=payload.reason,
            user=request.user,
            proof_id=payload.proof_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {
        "id": str(adjustment.id),
        "adjustment_number": adjustment.adjustment_number,
        "status": adjustment.status,
        "approval_id": str(adjustment.approval_id) if adjustment.approval_id else None,
    }


@router.post("/stock-adjustments/{adjustment_id}/approve")
def approve_stock_adjustment(request: HttpRequest, adjustment_id: UUID):
    context = require_capability(request, "inventory.stock_adjustments.approve")
    adjustment = StockAdjustment.objects.filter(
        tenant=context.tenant, id=adjustment_id
    ).first()
    if adjustment is None:
        raise HttpError(404, "Stock adjustment tidak ditemukan")
    try:
        adjustment = approve_and_post_stock_adjustment(adjustment, user=request.user)
    except PermissionError as exc:
        raise HttpError(403, str(exc)) from exc
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {"id": str(adjustment.id), "status": adjustment.status}


@router.post("/purchases/{po_id}/confirm", response=PurchaseOrderResponse)
def confirm_po(request: HttpRequest, po_id: str):
    context = require_capability(request, "inventory.purchases.confirm")
    po = PurchaseOrder.objects.filter(tenant=context.tenant, id=po_id).first()
    if not po:
        raise HttpError(404, "Purchase Order tidak ditemukan")

    try:
        return confirm_purchase_order(po, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/purchases/{po_id}/cancel", response=PurchaseOrderResponse)
def cancel_po(request: HttpRequest, po_id: str):
    context = require_capability(request, "inventory.purchases.cancel")
    po = PurchaseOrder.objects.filter(tenant=context.tenant, id=po_id).first()
    if not po:
        raise HttpError(404, "Purchase Order tidak ditemukan")

    try:
        return cancel_purchase_order(po, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
