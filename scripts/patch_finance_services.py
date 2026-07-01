with open("backend/finance/services.py", "r") as f:
    content = f.read()

# Add missing models
if "SupplierInvoice," not in content:
    content = content.replace(
        "from backend.finance.models import (",
        "from backend.finance.models import (\n    SupplierInvoice,",
    )

# Add PurchaseOrder from inventory if not exists
if "PurchaseOrder" not in content:
    content = content.replace(
        "from backend.inventory.models import MaterialLedger",
        "from backend.inventory.models import MaterialLedger, PurchaseOrder",
    )

# Add SupplierPayment from finance models
if "SupplierPayment" not in content:
    content = content.replace(
        "from backend.finance.models import (",
        "from backend.finance.models import (\n    SupplierPayment,",
    )


# Update pay_payment_request
def replace_pay_request(match):
    return (
        match.group(0)
        + """
    if payment_request.source_type == "OperatorWorkLogBatch":
        work_log_ids = payment_request.source_id.split(",")
        from backend.production.models import OperatorWorkLog
        from backend.production.models import JobPacket
        
        OperatorWorkLog.objects.filter(id__in=work_log_ids).update(is_paid=True)
        # Assuming the job packets should also be updated or we just update the work logs
        packet_ids = OperatorWorkLog.objects.filter(id__in=work_log_ids).values_list('progress__job_packet_id', flat=True)
        JobPacket.objects.filter(id__in=packet_ids).update(status=JobPacket.Status.PAID)
"""
    )


# Actually, replacing pay_payment_request is trickier. Let's append new logic or edit via re.sub.
# It's better to just do a string replace on pay_payment_request inside python.

with open("backend/finance/services.py", "w") as f:
    f.write(content)
