from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from backend.masterdata.models import (
    BOM,
    BaseModel,
    Material,
    Operator,
    ProductVariant,
    Routing,
    RoutingStage,
    Supplier,
)
from backend.sales.models import SalesPOLine


class ProductionOrder(BaseModel):
    class Type(models.TextChoices):
        FOR_PO = "for_po", "Untuk PO"
        FOR_STOCK = "for_stock", "Untuk Stok"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PLANNED = "planned", "Direncanakan"
        RELEASED = "released", "Dirilis"
        IN_PROGRESS = "in_progress", "Dalam Proses"
        QC_PACKING = "qc_packing", "QC/Packing"
        COMPLETED = "completed", "Selesai"
        CLOSED = "closed", "Ditutup"
        CANCELLED = "cancelled", "Dibatalkan"

    order_number = models.CharField("Nomor SPK", max_length=50)
    order_type = models.CharField("Tipe Order", max_length=20, choices=Type.choices)
    sales_po_line = models.ForeignKey(
        SalesPOLine,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_orders",
    )
    product_variant = models.ForeignKey(ProductVariant, on_delete=models.RESTRICT)
    target_quantity = models.PositiveIntegerField("Target Kuantitas")
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    target_completion_date = models.DateField("Target Selesai", null=True, blank=True)
    bom = models.ForeignKey(BOM, on_delete=models.SET_NULL, null=True, blank=True)
    routing = models.ForeignKey(
        Routing, on_delete=models.PROTECT, null=True, blank=True
    )
    bom_snapshot = models.JSONField(default=dict, blank=True)
    routing_snapshot = models.JSONField(default=dict, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    output_quantity = models.PositiveIntegerField(default=0)
    reconciliation_notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "production_order"
        unique_together = [("tenant", "order_number")]

    def __str__(self):
        return self.order_number


class JobPacket(BaseModel):
    class Status(models.TextChoices):
        ASSIGNED = "assigned", "Ditugaskan"
        ACCEPTED = "accepted", "Diterima"
        SUBMITTED = "submitted", "Dikirim Operator"
        VERIFIED = "verified", "Diverifikasi"
        BILLABLE = "billable", "Layak Ditagihkan"
        PAID = "paid", "Dibayar"

    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.CASCADE, related_name="job_packets"
    )
    packet_number = models.CharField("Nomor Paket", max_length=50)
    quantity = models.PositiveIntegerField("Kuantitas Paket")
    current_stage = models.ForeignKey(
        RoutingStage, on_delete=models.RESTRICT, null=True, blank=True
    )
    assigned_operator = models.ForeignKey(
        Operator,
        on_delete=models.RESTRICT,
        related_name="job_packets",
        null=True,
        blank=True,
    )
    external_supplier = models.ForeignKey(
        Supplier,
        on_delete=models.RESTRICT,
        related_name="external_job_packets",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ASSIGNED
    )
    assigned_at = models.DateTimeField(default=timezone.now)
    accepted_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "production_job_packet"
        unique_together = [("tenant", "packet_number")]


class ProductionStageProgress(BaseModel):
    job_packet = models.ForeignKey(
        JobPacket, on_delete=models.CASCADE, related_name="progresses"
    )
    stage = models.ForeignKey(RoutingStage, on_delete=models.RESTRICT)
    operator = models.ForeignKey(Operator, on_delete=models.RESTRICT)
    qty_in = models.PositiveIntegerField("Qty Masuk", default=0)
    qty_good = models.PositiveIntegerField("Qty Baik/Lolos", default=0)
    qty_defect = models.PositiveIntegerField("Qty Cacat", default=0)
    qty_rework = models.PositiveIntegerField("Qty Rework", default=0)
    qty_scrap = models.PositiveIntegerField("Qty Scrap", default=0)
    qty_remaining = models.PositiveIntegerField("Qty Tersisa", default=0)
    defect_type = models.CharField(max_length=100, blank=True, default="")
    duration_minutes = models.PositiveIntegerField(default=0)
    submitted_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    correction_reason = models.TextField(blank=True, default="")
    is_verified = models.BooleanField("Diverifikasi", default=False)
    # Auditing and corrections will track changes to this record

    class Meta:
        db_table = "production_stage_progress"

    def clean(self):
        super().clean()
        accounted = (
            self.qty_good + self.qty_defect + self.qty_scrap + self.qty_remaining
        )
        if accounted != self.qty_in:
            raise ValidationError(
                "Qty masuk harus sama dengan qty baik + cacat + scrap + tersisa."
            )
        if self.qty_rework > self.qty_defect:
            raise ValidationError("Qty rework tidak boleh melebihi qty cacat.")


class OperatorWorkLog(BaseModel):
    """
    Catatan hasil untuk pembayaran borongan yang diklaim dari ProductionStageProgress.
    """

    progress = models.ForeignKey(ProductionStageProgress, on_delete=models.CASCADE)
    operator = models.ForeignKey(Operator, on_delete=models.RESTRICT)
    qty_claimed = models.PositiveIntegerField("Qty Diklaim")
    piece_rate_applied = models.DecimalField(
        "Tarif Diterapkan", max_digits=15, decimal_places=2
    )
    amount_total = models.DecimalField("Total Bruto", max_digits=15, decimal_places=2)
    is_paid = models.BooleanField("Sudah Dibayar", default=False)
    is_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    rate_adjustment_reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "production_operator_work_log"
        constraints = [
            models.UniqueConstraint(
                fields=["progress", "operator"], name="uniq_worklog_progress_operator"
            )
        ]


class MaterialRequirement(BaseModel):
    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.CASCADE, related_name="material_requirements"
    )
    material = models.ForeignKey(Material, on_delete=models.RESTRICT)
    source_bom_item_id = models.UUIDField(null=True, blank=True)
    material_code_snapshot = models.CharField(max_length=50, blank=True, default="")
    material_name_snapshot = models.CharField(max_length=255, blank=True, default="")
    quantity_per_unit = models.DecimalField(
        max_digits=18, decimal_places=4, default=0
    )
    usage_uom_code_snapshot = models.CharField(max_length=20, blank=True, default="")
    purchase_uom_code_snapshot = models.CharField(max_length=20, blank=True, default="")
    conversion_ratio_snapshot = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("1")
    )
    shrinkage_percent_snapshot = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("0")
    )
    required_usage_qty = models.DecimalField(max_digits=18, decimal_places=4)
    available_usage_qty = models.DecimalField(
        max_digits=18, decimal_places=4, default=0
    )
    reserved_usage_qty = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    ordered_purchase_qty = models.DecimalField(
        max_digits=18, decimal_places=4, default=0
    )
    shortage_usage_qty = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    recommended_purchase_qty = models.DecimalField(
        max_digits=18, decimal_places=4, default=0
    )
    packaging_excess_usage_qty = models.DecimalField(
        max_digits=18, decimal_places=4, default=0
    )
    calculation_version = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "production_material_requirement"
        constraints = [
            models.UniqueConstraint(
                fields=["production_order", "material"],
                name="uniq_order_material_requirement",
            )
        ]


class MaterialReservation(BaseModel):
    requirement = models.ForeignKey(
        MaterialRequirement, on_delete=models.CASCADE, related_name="reservations"
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    consumed_quantity = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    released_quantity = models.DecimalField(max_digits=18, decimal_places=4, default=0)

    class Meta:
        db_table = "production_material_reservation"


class MaterialConsumption(BaseModel):
    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.PROTECT, related_name="material_consumptions"
    )
    material = models.ForeignKey(Material, on_delete=models.RESTRICT)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=4)
    transaction_type = models.CharField(
        max_length=20,
        choices=[("issue", "Keluar"), ("return", "Kembali")],
        default="issue",
    )
    inventory_reference = models.CharField(max_length=100)

    class Meta:
        db_table = "production_material_consumption"


class ReworkOrder(BaseModel):
    class Status(models.TextChoices):
        OPEN = "open", "Terbuka"
        IN_PROGRESS = "in_progress", "Dikerjakan"
        PASSED = "passed", "Lolos"
        FAILED = "failed", "Gagal"

    source_progress = models.ForeignKey(
        ProductionStageProgress, on_delete=models.PROTECT, related_name="rework_orders"
    )
    target_stage = models.ForeignKey(RoutingStage, on_delete=models.RESTRICT)
    operator = models.ForeignKey(Operator, on_delete=models.RESTRICT)
    quantity = models.PositiveIntegerField()
    result_good = models.PositiveIntegerField(default=0)
    result_scrap = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN
    )

    class Meta:
        db_table = "production_rework_order"


class ScrapRecord(BaseModel):
    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.PROTECT, related_name="scrap_records"
    )
    source_progress = models.ForeignKey(
        ProductionStageProgress, on_delete=models.PROTECT, null=True, blank=True
    )
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    value = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    reason = models.TextField()
    responsible_operator = models.ForeignKey(
        Operator, on_delete=models.RESTRICT, null=True, blank=True
    )
    approved_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    approval = models.ForeignKey(
        "core.ApprovalRequest", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "production_scrap_record"


class WIPBalance(BaseModel):
    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.CASCADE, related_name="wip_balances"
    )
    stage = models.ForeignKey(RoutingStage, on_delete=models.RESTRICT)
    quantity = models.PositiveIntegerField(default=0)
    value = models.DecimalField(max_digits=18, decimal_places=2, default=0)

    class Meta:
        db_table = "production_wip_balance"
        constraints = [
            models.UniqueConstraint(
                fields=["production_order", "stage"], name="uniq_order_stage_wip"
            )
        ]


class ProductionCost(BaseModel):
    production_order = models.ForeignKey(
        ProductionOrder, on_delete=models.PROTECT, related_name="costs"
    )
    component = models.CharField(max_length=80)
    source_type = models.CharField(max_length=100)
    source_id = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    allocation_basis = models.CharField(max_length=50, blank=True, default="")

    class Meta:
        db_table = "production_cost"


class HPPSnapshot(BaseModel):
    class CostType(models.TextChoices):
        ESTIMATED = "estimated", "Estimasi"
        ACTUAL = "actual", "Aktual Produksi"
        INVENTORY = "inventory", "Persediaan/COGS"

    production_order = models.ForeignKey(
        ProductionOrder,
        on_delete=models.PROTECT,
        related_name="hpp_snapshots",
        null=True,
        blank=True,
    )
    product_variant = models.ForeignKey(ProductVariant, on_delete=models.RESTRICT)
    cost_type = models.CharField(max_length=20, choices=CostType.choices)
    total_cost = models.DecimalField(max_digits=18, decimal_places=2)
    quantity = models.DecimalField(max_digits=18, decimal_places=4)
    unit_cost = models.DecimalField(max_digits=18, decimal_places=4)
    components = models.JSONField(default=dict)
    source_versions = models.JSONField(default=dict)
    margin_percent = models.DecimalField(
        max_digits=7, decimal_places=2, default=Decimal("0")
    )
    recommended_price = models.DecimalField(max_digits=18, decimal_places=2, default=0)

    class Meta:
        db_table = "production_hpp_snapshot"
