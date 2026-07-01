from django.db import models

from backend.inventory.models import PurchaseOrder, PurchaseOrderLine
from backend.masterdata.models import (
    BankAccount,
    BaseModel,
    CostCategory,
    Customer,
    Supplier,
)
from backend.sales.models import SalesPO


class Asset(BaseModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Aktif"
        INACTIVE = "inactive", "Tidak Digunakan"
        BROKEN = "broken", "Rusak"
        SOLD = "sold", "Dijual/Dilepas"
        RETIRED = "retired", "Dihentikan"

    name = models.CharField("Nama Aset", max_length=255)
    category = models.CharField("Kategori", max_length=100)
    acquisition_value = models.DecimalField(
        "Nilai Perolehan", max_digits=15, decimal_places=2
    )
    acquisition_date = models.DateField("Tanggal Perolehan")
    useful_life_months = models.PositiveIntegerField("Umur Ekonomis (Bulan)")
    depreciation_start_date = models.DateField("Tanggal Mulai Penyusutan")
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.ACTIVE
    )
    location = models.CharField("Lokasi", max_length=100, blank=True, default="")
    depreciation_method = models.CharField(
        max_length=30,
        choices=[("straight_line", "Garis Lurus")],
        default="straight_line",
    )
    disposal_date = models.DateField(null=True, blank=True)
    disposal_reason = models.TextField(blank=True, default="")
    disposal_value = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    disposal_proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_asset"


class DepreciationSchedule(BaseModel):
    asset = models.ForeignKey(
        Asset, on_delete=models.CASCADE, related_name="depreciations"
    )
    date = models.DateField("Tanggal Penyusutan")
    amount = models.DecimalField("Nominal Penyusutan", max_digits=15, decimal_places=2)
    is_posted = models.BooleanField("Sudah Diposting", default=False)

    class Meta:
        db_table = "finance_asset_depreciation"


class PettyCashTransaction(BaseModel):
    class Type(models.TextChoices):
        IN = "in", "Uang Masuk (Pengisian)"
        OUT = "out", "Uang Keluar (Pengeluaran)"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        VERIFIED = "verified", "Diverifikasi"
        POSTED = "posted", "Dibukukan"

    date = models.DateField("Tanggal Transaksi")
    type = models.CharField("Jenis Transaksi", max_length=10, choices=Type.choices)
    amount = models.DecimalField("Nominal", max_digits=15, decimal_places=2)
    category = models.CharField(
        "Kategori Pengeluaran", max_length=100, blank=True, default=""
    )
    description = models.TextField("Keterangan", blank=True, default="")
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    pic = models.CharField("Penanggung Jawab", max_length=100, blank=True, default="")
    account = models.ForeignKey(
        BankAccount,
        on_delete=models.RESTRICT,
        related_name="petty_cash_transactions",
        null=True,
        blank=True,
    )
    funding_mode = models.CharField(
        max_length=30,
        choices=[
            ("advance", "Uang Muka"),
            ("reimbursement", "Reimbursement"),
            ("mixed", "Kombinasi"),
            ("company_fund", "Dana Konveksi"),
        ],
        default="company_fund",
    )
    claimant_name = models.CharField(max_length=150, blank=True, default="")
    meal_people_count = models.PositiveIntegerField(default=0)
    purchased_items = models.JSONField(default=list, blank=True)
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )
    created_by = models.ForeignKey(
        "core.User",
        on_delete=models.PROTECT,
        related_name="created_petty_cash",
        null=True,
        blank=True,
    )
    verified_by = models.ForeignKey(
        "core.User",
        on_delete=models.PROTECT,
        related_name="verified_petty_cash",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "finance_petty_cash_transaction"


class SupplierInvoice(BaseModel):
    class Status(models.TextChoices):
        UNPAID = "unpaid", "Belum Dibayar"
        PARTIAL = "partial", "Dibayar Sebagian"
        PAID = "paid", "Lunas"
        CANCELLED = "cancelled", "Dibatalkan"

    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.RESTRICT,
        related_name="invoices",
        null=True,
        blank=True,
    )
    supplier = models.ForeignKey(Supplier, on_delete=models.RESTRICT)
    invoice_number = models.CharField("Nomor Invoice Pemasok", max_length=100)
    date = models.DateField("Tanggal Invoice")
    due_date = models.DateField("Tanggal Jatuh Tempo", blank=True, null=True)
    total_amount = models.DecimalField("Total Tagihan", max_digits=15, decimal_places=2)
    amount_paid = models.DecimalField(
        "Sudah Dibayar", max_digits=15, decimal_places=2, default=0
    )
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.UNPAID
    )
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_supplier_invoice"


class SupplierInvoiceLine(BaseModel):
    invoice = models.ForeignKey(
        SupplierInvoice, on_delete=models.CASCADE, related_name="lines"
    )
    purchase_order_line = models.ForeignKey(
        PurchaseOrderLine, on_delete=models.PROTECT, related_name="invoice_lines"
    )
    quantity = models.DecimalField("Kuantitas Invoice", max_digits=15, decimal_places=4)
    unit_price = models.DecimalField(
        "Harga Satuan Invoice", max_digits=15, decimal_places=2
    )
    line_total = models.DecimalField("Total Baris", max_digits=15, decimal_places=2)

    class Meta:
        db_table = "finance_supplier_invoice_line"


class SupplierPayment(BaseModel):
    invoice = models.ForeignKey(
        SupplierInvoice, on_delete=models.RESTRICT, related_name="payments"
    )
    date = models.DateField("Tanggal Pembayaran")
    amount = models.DecimalField("Nominal Pembayaran", max_digits=15, decimal_places=2)
    payment_method = models.CharField("Metode Pembayaran", max_length=50)
    reference = models.CharField(
        "Referensi (No. Cek/Transfer)", max_length=100, blank=True, default=""
    )
    account = models.ForeignKey(
        BankAccount, on_delete=models.RESTRICT, null=True, blank=True
    )
    recipient = models.CharField(max_length=200, blank=True, default="")
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )
    paid_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_supplier_payment"


class CustomerInvoice(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        UNPAID = "unpaid", "Belum Dibayar/DP"
        PARTIAL = "partial", "Dibayar Sebagian"
        PAID = "paid", "Lunas"

    sales_po = models.ForeignKey(
        SalesPO, on_delete=models.RESTRICT, related_name="invoices"
    )
    customer = models.ForeignKey(Customer, on_delete=models.RESTRICT)
    invoice_number = models.CharField("Nomor Invoice", max_length=50)
    date = models.DateField("Tanggal Invoice")
    due_date = models.DateField("Tanggal Jatuh Tempo", blank=True, null=True)
    total_amount = models.DecimalField("Total Tagihan", max_digits=15, decimal_places=2)
    amount_paid = models.DecimalField(
        "Sudah Dibayar", max_digits=15, decimal_places=2, default=0
    )
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    issued_at = models.DateTimeField(null=True, blank=True)
    adjustment_total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    deliveries = models.ManyToManyField(
        "sales.Delivery", through="InvoiceDelivery", related_name="customer_invoices"
    )

    class Meta:
        db_table = "finance_customer_invoice"
        unique_together = [("tenant", "invoice_number")]


class CustomerAdvance(BaseModel):
    sales_po = models.ForeignKey(
        SalesPO, on_delete=models.PROTECT, related_name="advances"
    )
    customer = models.ForeignKey(Customer, on_delete=models.RESTRICT)
    date = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    allocated_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    account = models.ForeignKey(BankAccount, on_delete=models.RESTRICT)
    reference = models.CharField(max_length=100, blank=True, default="")
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_customer_advance"


class CustomerPayment(BaseModel):
    invoice = models.ForeignKey(
        CustomerInvoice,
        on_delete=models.RESTRICT,
        related_name="payments",
        null=True,
        blank=True,
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.RESTRICT, null=True, blank=True
    )
    sales_po = models.ForeignKey(
        SalesPO,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
    )
    date = models.DateField("Tanggal Pembayaran")
    amount = models.DecimalField("Nominal Pembayaran", max_digits=15, decimal_places=2)
    payment_method = models.CharField("Metode Pembayaran", max_length=50)
    reference = models.CharField("Referensi", max_length=100, blank=True, default="")
    account = models.ForeignKey(
        BankAccount, on_delete=models.RESTRICT, null=True, blank=True
    )
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_customer_payment"


class InvoiceDelivery(BaseModel):
    invoice = models.ForeignKey(CustomerInvoice, on_delete=models.PROTECT)
    delivery = models.OneToOneField("sales.Delivery", on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        db_table = "finance_invoice_delivery"


class CustomerPaymentAllocation(BaseModel):
    payment = models.ForeignKey(
        CustomerPayment, on_delete=models.PROTECT, related_name="allocations"
    )
    invoice = models.ForeignKey(
        CustomerInvoice, on_delete=models.PROTECT, related_name="payment_allocations"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        db_table = "finance_customer_payment_allocation"
        constraints = [
            models.UniqueConstraint(
                fields=["payment", "invoice"], name="uniq_payment_invoice_allocation"
            )
        ]


class AdvanceAllocation(BaseModel):
    advance = models.ForeignKey(
        CustomerAdvance, on_delete=models.PROTECT, related_name="allocations"
    )
    invoice = models.ForeignKey(
        CustomerInvoice, on_delete=models.PROTECT, related_name="advance_allocations"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        db_table = "finance_advance_allocation"


class PaymentRequest(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Diajukan"
        WAITING = "waiting_finance", "Menunggu Finance"
        DEFERRED = "deferred", "Ditunda"
        PAID = "paid", "Dibayar"
        COMPLETED = "completed", "Selesai"
        CANCELLED = "cancelled", "Dibatalkan"

    request_number = models.CharField(max_length=50)
    request_type = models.CharField(max_length=50)
    source_type = models.CharField(max_length=100)
    source_id = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    recipient = models.CharField(max_length=200)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=30, choices=Status.choices, default=Status.DRAFT
    )
    requested_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, related_name="payment_requests"
    )
    account = models.ForeignKey(
        BankAccount, on_delete=models.RESTRICT, null=True, blank=True
    )
    payment_date = models.DateField(null=True, blank=True)
    payment_method = models.CharField(max_length=50, blank=True, default="")
    defer_reason = models.TextField(blank=True, default="")
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_payment_request"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "request_number"], name="uniq_payment_request"
            )
        ]


class Expense(BaseModel):
    category = models.ForeignKey(CostCategory, on_delete=models.RESTRICT)
    date = models.DateField()
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    account = models.ForeignKey(BankAccount, on_delete=models.RESTRICT)
    related_party = models.CharField(max_length=200, blank=True, default="")
    production_order = models.ForeignKey(
        "production.ProductionOrder", on_delete=models.PROTECT, null=True, blank=True
    )
    description = models.TextField()
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "finance_expense"


class CostAllocation(BaseModel):
    period = models.ForeignKey("accounting.AccountingPeriod", on_delete=models.PROTECT)
    category = models.ForeignKey(CostCategory, on_delete=models.RESTRICT)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    allocation_basis = models.CharField(max_length=50)
    allocations = models.JSONField(default=list)
    reason = models.TextField()
    created_by = models.ForeignKey("core.User", on_delete=models.PROTECT)

    class Meta:
        db_table = "finance_cost_allocation"
