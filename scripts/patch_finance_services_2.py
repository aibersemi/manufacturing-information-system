with open("backend/finance/services.py", "r") as f:
    content = f.read()

# Add logic to pay_payment_request
patch = """        "date": payment_date,
        },
    )
    
    if payment_request.source_type == "OperatorWorkLogBatch":
        work_log_ids = payment_request.source_id.split(",")
        from backend.production.models import OperatorWorkLog
        from backend.production.models import JobPacket
        
        OperatorWorkLog.objects.filter(id__in=work_log_ids).update(is_paid=True)
        # Update job packet status
        packet_ids = OperatorWorkLog.objects.filter(id__in=work_log_ids).values_list('progress__job_packet_id', flat=True)
        JobPacket.objects.filter(id__in=packet_ids).update(status=JobPacket.Status.PAID)

    return payment_request"""

content = content.replace(
    """        "date": payment_date,
        },
    )
    return payment_request""",
    patch,
)


new_funcs = """

@transaction.atomic
def create_supplier_invoice_from_purchase_order(
    po: PurchaseOrder,
    *,
    user: User,
    invoice_number: str,
    date,
    due_date=None,
    total_amount: Decimal
) -> SupplierInvoice:
    if po.status not in {PurchaseOrder.Status.COMPLETED, PurchaseOrder.Status.PARTIAL_RECEIPT}:
        raise ValueError("Hanya PO dengan penerimaan material yang dapat ditagihkan.")
        
    invoice = SupplierInvoice.objects.create(
        tenant=po.tenant,
        purchase_order=po,
        supplier=po.supplier,
        invoice_number=invoice_number,
        date=date,
        due_date=due_date,
        total_amount=total_amount,
    )
    
    record_audit(
        tenant=po.tenant,
        user=user,
        action="supplier_invoice_created",
        resource_type="SupplierInvoice",
        resource_id=invoice.id,
        after=model_snapshot(invoice),
    )
    return invoice

@transaction.atomic
def pay_supplier_invoice(
    invoice: SupplierInvoice,
    *,
    user: User,
    account: BankAccount,
    payment_date,
    amount: Decimal,
    reference: str,
    proof_id: str = None
):
    if invoice.status == SupplierInvoice.Status.PAID:
        raise ValueError("Invoice sudah lunas.")
        
    if amount <= 0:
        raise ValueError("Jumlah pembayaran harus lebih besar dari nol.")
        
    invoice = SupplierInvoice.objects.select_for_update().get(pk=invoice.pk)
    
    payment = SupplierPayment.objects.create(
        tenant=invoice.tenant,
        invoice=invoice,
        account=account,
        payment_date=payment_date,
        amount=amount,
        reference=reference,
        proof_id=proof_id,
        status="completed"
    )
    
    invoice.amount_paid += amount
    if invoice.amount_paid >= invoice.total_amount:
        invoice.status = SupplierInvoice.Status.PAID
    else:
        invoice.status = SupplierInvoice.Status.PARTIAL
        
    invoice.save(update_fields=["amount_paid", "status", "updated_at"])
    
    create_operational_journal_safe(
        tenant=invoice.tenant,
        event_type="payment.supplier_invoice",
        amount=amount,
        journal_date=payment_date,
        source_type="SupplierPayment",
        source_id=str(payment.id),
        description=f"Pembayaran invoice {invoice.invoice_number}",
        final=True,
        user=user,
    )
    
    record_audit(
        tenant=invoice.tenant,
        user=user,
        action="supplier_invoice_paid",
        resource_type="SupplierInvoice",
        resource_id=invoice.id,
        after={"payment_id": str(payment.id), "amount_paid": invoice.amount_paid, "status": invoice.status},
    )
    return payment
"""

with open("backend/finance/services.py", "w") as f:
    f.write(content + new_funcs)
