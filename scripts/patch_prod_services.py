with open("backend/production/services.py", "r") as f:
    content = f.read()

# Add next_document_number
content = content.replace(
    "request_approval,\n)", "request_approval,\n    next_document_number,\n)"
)

# Add SalesPOLine
content = content.replace(
    "from backend.sales.models import SalesPO",
    "from backend.sales.models import SalesPO, SalesPOLine",
)

# Add missing production models
content = content.replace(
    "from backend.production.models import (",
    "from backend.production.models import (\n    MaterialConsumption,\n    MaterialReservation,",
)

# Add missing inventory models
content = content.replace(
    "from backend.inventory.models import ProductBatch, ProductLedger, PurchaseOrderLine",
    "from backend.inventory.models import ProductBatch, ProductLedger, PurchaseOrderLine, PurchaseRequest, MaterialLedger",
)


# Append new functions at the end of the file
new_funcs = """

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
def reserve_materials_for_order(order: ProductionOrder, *, user: User) -> list[MaterialReservation]:
    order = ProductionOrder.objects.select_for_update().get(pk=order.pk)
    if order.status not in {ProductionOrder.Status.PLANNED, ProductionOrder.Status.RELEASED, ProductionOrder.Status.IN_PROGRESS}:
        raise ValueError("Production Order belum siap untuk reservasi material.")
    
    reservations = []
    requirements = order.material_requirements.select_related("material").all()
    for req in requirements:
        req = MaterialRequirement.objects.select_for_update().get(pk=req.pk)
        if req.reserved_usage_qty > 0:
            res, created = MaterialReservation.objects.update_or_create(
                tenant=order.tenant,
                requirement=req,
                defaults={"quantity": req.reserved_usage_qty}
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
def generate_purchase_requests_from_requirements(order: ProductionOrder, *, user: User) -> list[PurchaseRequest]:
    if order.status not in {ProductionOrder.Status.PLANNED, ProductionOrder.Status.RELEASED}:
        raise ValueError("Production Order belum siap untuk pengajuan pembelian.")
        
    requests = []
    requirements = order.material_requirements.select_related("material").filter(recommended_purchase_qty__gt=0)
    for req in requirements:
        existing_pr = PurchaseRequest.objects.filter(
            tenant=order.tenant,
            production_order=order,
            material=req.material,
            status=PurchaseRequest.Status.DRAFT
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
                requested_qty=req.recommended_purchase_qty
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
def issue_materials_to_production(order: ProductionOrder, *, user: User) -> list[MaterialConsumption]:
    if order.status not in {ProductionOrder.Status.RELEASED, ProductionOrder.Status.IN_PROGRESS}:
        raise ValueError("Production Order tidak dapat menerima issue material pada status saat ini.")
    
    consumptions = []
    from django.db import models
    reservations_ids = order.material_requirements.filter(reservations__isnull=False).values_list('reservations__id', flat=True)
    res_qs = MaterialReservation.objects.filter(id__in=reservations_ids, quantity__gt=models.F('released_quantity')).select_related('requirement__material')
    
    for res in res_qs:
        qty_to_issue = res.quantity - res.released_quantity
        if qty_to_issue <= 0:
            continue
            
        material = res.requirement.material
        
        bal = material_balance(order.tenant, material)
        if bal < qty_to_issue:
            raise ValueError(f"Stok material {material.name} tidak mencukupi untuk dikeluarkan sejumlah {qty_to_issue}.")
            
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


def adjust_operator_work_log_rate(work_log: OperatorWorkLog, *, user: User, new_rate: Decimal, reason: str) -> OperatorWorkLog:
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
    
    work_log.save(update_fields=["piece_rate_applied", "amount_total", "rate_adjustment_reason", "is_verified", "verified_by", "verified_at", "updated_at"])
    
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
def create_operator_payment_request(work_log_ids: list[str], *, user: User, due_date=None):
    from datetime import date
    work_logs = list(OperatorWorkLog.objects.filter(id__in=work_log_ids).select_related('operator', 'tenant'))
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
            raise ValueError("Hanya log kerja yang sudah diverifikasi yang dapat diajukan pembayaran.")
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

"""

with open("backend/production/services.py", "w") as f:
    f.write(content + new_funcs)
