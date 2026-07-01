with open("backend/inventory/services.py", "r") as f:
    content = f.read()

# Add PurchaseOrder to imports if needed. We know PurchaseOrderLine is there, but is PurchaseOrder?
if "PurchaseOrder," not in content and "PurchaseOrder " not in content:
    content = content.replace(
        "from backend.inventory.models import (",
        "from backend.inventory.models import (\n    PurchaseOrder,",
    )


# Append new functions at the end of the file
new_funcs = """

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

"""

with open("backend/inventory/services.py", "w") as f:
    f.write(content + new_funcs)
