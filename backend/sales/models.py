from django.db import models

from backend.masterdata.models import BaseModel, Customer, ProductVariant


class SalesPO(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        CONFIRMED = "confirmed", "Dikonfirmasi"
        PLANNED = "planned", "Direncanakan"
        IN_PRODUCTION = "in_production", "Dalam Produksi"
        PARTIAL = "partial", "Terpenuhi Sebagian"
        COMPLETED = "completed", "Selesai"
        CANCELLED = "cancelled", "Dibatalkan"

    class FulfillmentStrategy(models.TextChoices):
        STOCK = "stock", "Stok"
        PRODUCTION = "production", "Produksi"
        COMBINED = "combined", "Gabungan"

    customer = models.ForeignKey(
        Customer, on_delete=models.RESTRICT, related_name="sales_pos"
    )
    po_number = models.CharField("Nomor PO", max_length=50)
    order_date = models.DateField("Tanggal Pesan")
    due_date = models.DateField("Tenggat Waktu", null=True, blank=True)
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    is_locked = models.BooleanField("Terkunci", default=False)
    locked_at = models.DateTimeField(null=True, blank=True)
    lock_reason = models.CharField(max_length=100, blank=True, default="")
    version = models.PositiveIntegerField("Versi/Revisi", default=1)
    fulfillment_strategy = models.CharField(
        max_length=20, choices=FulfillmentStrategy.choices, blank=True, default=""
    )
    short_closed_at = models.DateTimeField(null=True, blank=True)
    short_close_reason = models.TextField(blank=True, default="")
    short_close_evidence = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )
    notes = models.TextField("Catatan", blank=True, default="")

    class Meta:
        db_table = "sales_po"
        unique_together = [("tenant", "po_number")]

    def __str__(self):
        return f"{self.po_number} - {self.customer.name}"


class SalesPOLine(BaseModel):
    sales_po = models.ForeignKey(
        SalesPO, on_delete=models.CASCADE, related_name="lines"
    )
    product_variant = models.ForeignKey(ProductVariant, on_delete=models.RESTRICT)
    quantity = models.PositiveIntegerField("Kuantitas")
    unit_price = models.DecimalField("Harga Jual", max_digits=15, decimal_places=2)
    fulfilled_qty = models.PositiveIntegerField("Terkirim", default=0)
    produced_qty = models.PositiveIntegerField(default=0)
    disposition_note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "sales_po_line"


class StockAllocation(BaseModel):
    """
    Mencatat alokasi stok produk jadi ke PO,
    tanpa mengambil keputusan pengiriman akhir.
    """

    sales_po_line = models.ForeignKey(
        SalesPOLine, on_delete=models.CASCADE, related_name="allocations"
    )
    product_batch = models.ForeignKey(
        "inventory.ProductBatch",
        on_delete=models.PROTECT,
        related_name="sales_allocations",
        null=True,
        blank=True,
    )
    allocated_qty = models.PositiveIntegerField("Kuantitas Dialokasikan")
    released_qty = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "sales_stock_allocation"
        constraints = [
            models.UniqueConstraint(
                fields=["sales_po_line", "product_batch"],
                name="uniq_line_batch_allocation",
            ),
            models.CheckConstraint(
                condition=models.Q(allocated_qty__gt=0),
                name="positive_stock_allocation",
            ),
        ]


class SalesPORevision(BaseModel):
    sales_po = models.ForeignKey(
        SalesPO, on_delete=models.PROTECT, related_name="revisions"
    )
    version = models.PositiveIntegerField()
    snapshot = models.JSONField(default=dict)
    reason = models.TextField()
    created_by = models.ForeignKey("core.User", on_delete=models.PROTECT)

    class Meta:
        db_table = "sales_po_revision"
        constraints = [
            models.UniqueConstraint(
                fields=["sales_po", "version"], name="uniq_sales_po_revision"
            )
        ]


class Delivery(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SHIPPED = "shipped", "Dikirim"
        DELIVERED = "delivered", "Diterima"
        RETURNED = "returned", "Dikembalikan Sebagian/Penuh"

    sales_po = models.ForeignKey(
        SalesPO, on_delete=models.RESTRICT, related_name="deliveries"
    )
    delivery_number = models.CharField("Nomor Surat Jalan", max_length=50)
    date = models.DateField("Tanggal Pengiriman")
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    shipping_cost = models.DecimalField(
        "Ongkos Kirim", max_digits=15, decimal_places=2, default=0
    )
    shipping_payer = models.CharField(
        "Penanggung Ongkos",
        max_length=20,
        choices=[
            ("customer", "Pelanggan"),
            ("company", "Konveksi"),
            ("free", "Gratis"),
        ],
        default="customer",
    )
    receiver_name = models.CharField(
        "Nama Penerima", max_length=100, blank=True, default=""
    )
    received_time = models.DateTimeField("Waktu Diterima", blank=True, null=True)
    delivery_address = models.TextField(blank=True, default="")
    receipt_proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sales_delivery"
        unique_together = [("tenant", "delivery_number")]


class DeliveryLine(BaseModel):
    delivery = models.ForeignKey(
        Delivery, on_delete=models.CASCADE, related_name="lines"
    )
    sales_po_line = models.ForeignKey(SalesPOLine, on_delete=models.RESTRICT)
    quantity = models.PositiveIntegerField("Kuantitas Dikirim")
    product_batch = models.ForeignKey(
        "inventory.ProductBatch", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "sales_delivery_line"


class SalesReturn(BaseModel):
    delivery = models.ForeignKey(
        Delivery, on_delete=models.RESTRICT, related_name="returns"
    )
    date = models.DateField("Tanggal Retur")
    reason = models.TextField("Alasan Retur")
    status = models.CharField(
        "Status",
        max_length=20,
        choices=[
            ("pending", "Menunggu Proses"),
            ("rework", "Rework"),
            ("refund", "Refund/Kerugian"),
        ],
        default="pending",
    )
    return_number = models.CharField(max_length=50, blank=True, default="")
    customer = models.ForeignKey(
        Customer, on_delete=models.RESTRICT, null=True, blank=True
    )
    invoice = models.ForeignKey(
        "finance.CustomerInvoice",
        on_delete=models.RESTRICT,
        related_name="returns",
        null=True,
        blank=True,
    )
    received_at = models.DateTimeField(null=True, blank=True)
    condition = models.CharField(max_length=100, blank=True, default="")
    financial_adjustment_reference = models.CharField(
        max_length=100, blank=True, default=""
    )
    replacement_delivery = models.ForeignKey(
        Delivery,
        on_delete=models.RESTRICT,
        related_name="source_returns",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "sales_return"


class SalesReturnLine(BaseModel):
    class Disposition(models.TextChoices):
        INSPECTION = "inspection", "Pemeriksaan"
        REWORK = "rework", "Rework"
        RESTOCK = "restock", "Kembali Siap Jual"
        REPLACE = "replace", "Kirim Ulang"
        LOSS = "loss", "Kerugian"

    sales_return = models.ForeignKey(
        SalesReturn, on_delete=models.CASCADE, related_name="lines"
    )
    delivery_line = models.ForeignKey(DeliveryLine, on_delete=models.RESTRICT)
    product_variant = models.ForeignKey(ProductVariant, on_delete=models.RESTRICT)
    quantity = models.PositiveIntegerField()
    disposition = models.CharField(
        max_length=20, choices=Disposition.choices, default=Disposition.INSPECTION
    )
    loss_value = models.DecimalField(max_digits=18, decimal_places=2, default=0)

    class Meta:
        db_table = "sales_return_line"
