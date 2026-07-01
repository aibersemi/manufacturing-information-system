with open("backend/api/inventory.py", "r") as f:
    content = f.read()

# Add imports for services
content = content.replace(
    "from backend.inventory.services import (",
    "from backend.inventory.services import (\n    confirm_purchase_order,\n    cancel_purchase_order,",
)

new_endpoints = """

@router.post("/purchases/{po_id}/confirm", response=PurchaseOrderResponse)
def confirm_po(request: HttpRequest, po_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    po = PurchaseOrder.objects.filter(tenant_id=tenant_id, id=po_id).first()
    if not po:
        raise HttpError(404, "Purchase Order tidak ditemukan")
        
    try:
        return confirm_purchase_order(po, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc

@router.post("/purchases/{po_id}/cancel", response=PurchaseOrderResponse)
def cancel_po(request: HttpRequest, po_id: str):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_MANAGEMENT)
    po = PurchaseOrder.objects.filter(tenant_id=tenant_id, id=po_id).first()
    if not po:
        raise HttpError(404, "Purchase Order tidak ditemukan")
        
    try:
        return cancel_purchase_order(po, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc

"""

with open("backend/api/inventory.py", "w") as f:
    f.write(content + new_endpoints)
