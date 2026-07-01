from django.db import models

from backend.masterdata.models import BaseModel, Material, ProductVariant, Supplier
from backend.production.models import ProductionOrder


class Warehouse(BaseModel):
    name = models.CharField(max_length=150, default="Gudang Utama")
    code = models.CharField(max_length=30, default="WH")

    class Meta:
        db_table = "inventory_warehouse"
        constraints = [
            models.UniqueConstraint(fields=["tenant"], name="one_warehouse_per_tenant")
        ]


class MaterialLedger(BaseModel):
    """
    Tabel append-only untuk mencatat pergerakan stok material.
    Saldo tidak disimpan statis agar konsisten.
    """

    class TransactionType(models.TextChoices):
        RECEIPT = "receipt", "Penerimaan (Masuk)"
        ISSUE = "issue", "Pengeluaran (Keluar)"
        RETURN = "return", "Pengembalian (Masuk)"
        ADJUSTMENT_IN = "adj_in", "Penyesuaian (Masuk)"
        ADJUSTMENT_OUT = "adj_out", "Penyesuaian (Keluar)"
        WASTE = "waste", "Waste/Rusak (Keluar)"

    material = models.ForeignKey(Material, on_delete=models.RESTRICT)
    transaction_type = models.CharField(
        "Tipe Transaksi", max_length=20, choices=TransactionType.choices
    )
    quantity = models.DecimalField(
        "Kuantitas (Satuan Pakai)", max_digits=15, decimal_places=4
    )
    unit_cost = models.DecimalField(
        "Harga Satuan (Beli)", max_digits=15, decimal_places=2, default=0
    )
    reference_document = models.CharField("Referensi Dokumen", max_length=100)
    notes = models.TextField("Catatan", blank=True, default="")
    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.PROTECT,
        related_name="material_ledger_entries",
        null=True,
        blank=True,
    )
    reason = models.TextField(blank=True, default="")
    responsible_user = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )
    conversion_ratio_snapshot = models.DecimalField(
        max_digits=18, decimal_places=6, default=1
    )
    idempotency_key = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        db_table = "inventory_material_ledger"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="uniq_material_movement_idempotency",
            )
        ]


class ProductBatch(BaseModel):
    class Status(models.TextChoices):
        OPEN = "open", "Tersedia"
        EXHAUSTED = "exhausted", "Habis"

    product_variant = models.ForeignKey(
        ProductVariant, on_delete=models.RESTRICT, related_name="batches"
    )
    lot_number = models.CharField(max_length=50)
    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.PROTECT,
        related_name="product_batches",
        null=True,
        blank=True,
    )
    received_quantity = models.PositiveIntegerField()
    unit_cost = models.DecimalField(max_digits=18, decimal_places=4)
    is_opening_balance = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN
    )

    class Meta:
        db_table = "inventory_product_batch"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "lot_number"], name="uniq_product_lot"
            )
        ]


class ProductLedger(BaseModel):
    class Category(models.TextChoices):
        AVAILABLE = "available", "Siap Dijual"
        ALLOCATED = "allocated", "Dialokasikan"
        IN_TRANSIT = "in_transit", "Dalam Pengiriman"
        DEFECT = "defect", "Cacat"
        REWORK = "rework", "Dalam Perbaikan"
        RETURNED = "returned", "Retur"
        SCRAPPED = "scrapped", "Rusak/Dibuang"

    class TransactionType(models.TextChoices):
        PRODUCTION_IN = "prod_in", "Hasil Produksi (Masuk)"
        SALES_OUT = "sales_out", "Pengiriman Penjualan (Keluar)"
        SALES_RETURN = "return_in", "Retur Penjualan (Masuk)"
        ADJUSTMENT_IN = "adj_in", "Penyesuaian (Masuk)"
        ADJUSTMENT_OUT = "adj_out", "Penyesuaian (Keluar)"

    product_variant = models.ForeignKey(ProductVariant, on_delete=models.RESTRICT)
    transaction_type = models.CharField(
        "Tipe Transaksi", max_length=20, choices=TransactionType.choices
    )
    quantity = models.IntegerField("Kuantitas")
    batch_lot_number = models.CharField("Batch/Lot", max_length=50)
    batch = models.ForeignKey(
        ProductBatch,
        on_delete=models.PROTECT,
        related_name="movements",
        null=True,
        blank=True,
    )
    from_category = models.CharField(
        max_length=20, choices=Category.choices, blank=True, default=""
    )
    to_category = models.CharField(
        max_length=20, choices=Category.choices, blank=True, default=""
    )
    unit_cost = models.DecimalField(
        "HPP Aktual / COGS", max_digits=18, decimal_places=4, default=0
    )
    reference_document = models.CharField("Referensi Dokumen", max_length=100)
    idempotency_key = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        db_table = "inventory_product_ledger"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="uniq_product_movement_idempotency",
            )
        ]


class PurchaseRequest(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Diajukan"
        ORDERED = "ordered", "Telah Dipesan"
        CANCELLED = "cancelled", "Dibatalkan"

    pr_number = models.CharField("Nomor PR", max_length=50)
    material = models.ForeignKey(Material, on_delete=models.RESTRICT)
    requested_qty = models.DecimalField(
        "Kuantitas (Beli)", max_digits=15, decimal_places=4
    )
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        db_table = "inventory_purchase_request"
        unique_together = [("tenant", "pr_number")]


class PurchaseOrder(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        CONFIRMED = "confirmed", "Dikonfirmasi"
        PARTIAL_RECEIPT = "partial_receipt", "Diterima Sebagian"
        COMPLETED = "completed", "Selesai"
        CANCELLED = "cancelled", "Dibatalkan"

    po_number = models.CharField("Nomor PO", max_length=50)
    supplier = models.ForeignKey(Supplier, on_delete=models.RESTRICT)
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    total_amount = models.DecimalField(
        "Total Nilai", max_digits=15, decimal_places=2, default=0
    )
    order_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    reconciliation_status = models.CharField(
        max_length=30,
        choices=[
            ("open", "Terbuka"),
            ("variance", "Ada Selisih"),
            ("reconciled", "Terekonsiliasi"),
        ],
        default="open",
    )

    class Meta:
        db_table = "inventory_purchase_order"
        unique_together = [("tenant", "po_number")]


class PurchaseOrderLine(BaseModel):
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.CASCADE, related_name="lines"
    )
    purchase_request = models.ForeignKey(
        PurchaseRequest, on_delete=models.SET_NULL, null=True, blank=True
    )
    material = models.ForeignKey(Material, on_delete=models.RESTRICT)
    quantity = models.DecimalField("Kuantitas (Beli)", max_digits=15, decimal_places=4)
    unit_price = models.DecimalField("Harga Beli", max_digits=15, decimal_places=2)
    received_qty = models.DecimalField(
        "Diterima", max_digits=15, decimal_places=4, default=0
    )
    invoiced_qty = models.DecimalField(max_digits=15, decimal_places=4, default=0)
    conversion_ratio_snapshot = models.DecimalField(
        max_digits=18, decimal_places=6, default=1
    )

    class Meta:
        db_table = "inventory_po_line"


class MaterialReceipt(BaseModel):
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.RESTRICT, related_name="receipts"
    )
    receipt_number = models.CharField("Nomor Penerimaan", max_length=50)
    receipt_date = models.DateField("Tanggal Terima")
    supplier_do_number = models.CharField(
        "Nomor Surat Jalan Supplier", max_length=100, blank=True, default=""
    )
    received_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "inventory_material_receipt"
        unique_together = [("tenant", "receipt_number")]


class MaterialReceiptLine(BaseModel):
    receipt = models.ForeignKey(
        MaterialReceipt, on_delete=models.CASCADE, related_name="lines"
    )
    purchase_order_line = models.ForeignKey(
        PurchaseOrderLine, on_delete=models.PROTECT, related_name="receipt_lines"
    )
    received_qty = models.DecimalField(max_digits=18, decimal_places=4)
    accepted_qty = models.DecimalField(max_digits=18, decimal_places=4)
    rejected_qty = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=4)
    variance_reason = models.TextField(blank=True, default="")
    reconciliation_status = models.CharField(
        max_length=20,
        choices=[
            ("matched", "Sesuai"),
            ("variance", "Selisih"),
            ("resolved", "Selesai"),
        ],
        default="matched",
    )

    class Meta:
        db_table = "inventory_material_receipt_line"


class StockOpname(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        COUNTED = "counted", "Selesai Hitung"
        APPROVED = "approved", "Disetujui"
        POSTED = "posted", "Dibukukan"

    opname_number = models.CharField(max_length=50)
    counted_at = models.DateTimeField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    reason = models.TextField(blank=True, default="")
    created_by = models.ForeignKey("core.User", on_delete=models.PROTECT)
    approved_by = models.ForeignKey(
        "core.User",
        on_delete=models.PROTECT,
        related_name="approved_stock_opnames",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "inventory_stock_opname"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "opname_number"], name="uniq_opname_number"
            )
        ]


class StockOpnameLine(BaseModel):
    stock_opname = models.ForeignKey(
        StockOpname, on_delete=models.CASCADE, related_name="lines"
    )
    material = models.ForeignKey(
        Material, on_delete=models.RESTRICT, null=True, blank=True
    )
    product_variant = models.ForeignKey(
        ProductVariant, on_delete=models.RESTRICT, null=True, blank=True
    )
    system_quantity = models.DecimalField(max_digits=18, decimal_places=4)
    physical_quantity = models.DecimalField(max_digits=18, decimal_places=4)
    difference_quantity = models.DecimalField(max_digits=18, decimal_places=4)
    reason = models.TextField()

    class Meta:
        db_table = "inventory_stock_opname_line"


class StockAdjustment(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Menunggu Approval"
        APPROVED = "approved", "Disetujui"
        POSTED = "posted", "Dibukukan"
        REJECTED = "rejected", "Ditolak"

    adjustment_number = models.CharField(max_length=50)
    material = models.ForeignKey(
        Material, on_delete=models.RESTRICT, null=True, blank=True
    )
    product_variant = models.ForeignKey(
        ProductVariant, on_delete=models.RESTRICT, null=True, blank=True
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    reason = models.TextField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    requested_by = models.ForeignKey("core.User", on_delete=models.PROTECT)
    approved_by = models.ForeignKey(
        "core.User",
        on_delete=models.PROTECT,
        related_name="approved_stock_adjustments",
        null=True,
        blank=True,
    )
    approval = models.ForeignKey(
        "core.ApprovalRequest", on_delete=models.PROTECT, null=True, blank=True
    )
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "inventory_stock_adjustment"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "adjustment_number"], name="uniq_adjustment_number"
            )
        ]
