with open("backend/api/finance.py", "r") as f:
    content = f.read()

# Add imports
content = content.replace(
    "from backend.finance.services import (",
    "from backend.finance.services import (\n    create_supplier_invoice_from_purchase_order,\n    pay_supplier_invoice,",
)
content = content.replace(
    "from backend.finance.models import (",
    "from backend.finance.models import (\n    SupplierInvoice,",
)

if "PurchaseOrder" not in content:
    content = content.replace(
        "from backend.masterdata.models import BankAccount, Operator",
        "from backend.masterdata.models import BankAccount, Operator\nfrom backend.inventory.models import PurchaseOrder",
    )

new_endpoints = """

class SupplierInvoicePayload(Schema):
    purchase_order_id: str
    invoice_number: str
    date: date
    due_date: Optional[date] = None
    total_amount: Decimal

class SupplierInvoiceResponse(Schema):
    id: str
    invoice_number: str
    date: date
    due_date: Optional[date]
    total_amount: str
    amount_paid: str
    status: str

@router.post("/supplier-invoices", response=SupplierInvoiceResponse)
def create_supplier_invoice(request: HttpRequest, payload: SupplierInvoicePayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_FINANCE)
    po = PurchaseOrder.objects.filter(id=payload.purchase_order_id, tenant_id=tenant_id).first()
    if not po:
        raise HttpError(404, "Purchase Order tidak ditemukan")
        
    try:
        inv = create_supplier_invoice_from_purchase_order(
            po=po,
            user=request.user,
            invoice_number=payload.invoice_number,
            date=payload.date,
            due_date=payload.due_date,
            total_amount=payload.total_amount
        )
        return {
            "id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "date": inv.date,
            "due_date": inv.due_date,
            "total_amount": str(inv.total_amount),
            "amount_paid": str(inv.amount_paid),
            "status": inv.status
        }
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc

@router.get("/supplier-invoices", response=list[SupplierInvoiceResponse])
def list_supplier_invoices(request: HttpRequest):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_FINANCE)
    qs = SupplierInvoice.objects.filter(tenant_id=tenant_id).order_by("-date", "-created_at")
    return [
        {
            "id": str(inv.id),
            "invoice_number": inv.invoice_number,
            "date": inv.date,
            "due_date": inv.due_date,
            "total_amount": str(inv.total_amount),
            "amount_paid": str(inv.amount_paid),
            "status": inv.status
        }
        for inv in qs
    ]


class PaySupplierInvoicePayload(Schema):
    account_id: str
    payment_date: date
    amount: Decimal
    reference: str = ""
    proof_id: Optional[str] = None

@router.post("/supplier-invoices/{invoice_id}/pay")
def pay_invoice(request: HttpRequest, invoice_id: str, payload: PaySupplierInvoicePayload):
    tenant_id = get_tenant_id(request, allowed_roles=ROLES_FINANCE)
    invoice = SupplierInvoice.objects.filter(id=invoice_id, tenant_id=tenant_id).first()
    if not invoice:
        raise HttpError(404, "Supplier Invoice tidak ditemukan")
        
    account = BankAccount.objects.filter(id=payload.account_id, tenant_id=tenant_id).first()
    if not account:
        raise HttpError(404, "Rekening Bank tidak ditemukan")
        
    try:
        pay = pay_supplier_invoice(
            invoice=invoice,
            user=request.user,
            account=account,
            payment_date=payload.payment_date,
            amount=payload.amount,
            reference=payload.reference,
            proof_id=payload.proof_id
        )
        return {"status": "ok", "payment_id": str(pay.id)}
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc

"""

with open("backend/api/finance.py", "w") as f:
    f.write(content + new_endpoints)
