import uuid
from decimal import Decimal

from django.apps import apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models

from backend.core.models import Tenant
from backend.masterdata.sku import (
    PRODUCT_MODEL_CODE_PATTERN,
    PRODUCT_VARIANT_SKU_PATTERN,
    build_product_variant_sku,
    normalize_sku_segment,
)


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE)
    created_at = models.DateTimeField("Dibuat", auto_now_add=True)
    updated_at = models.DateTimeField("Diperbarui", auto_now=True)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not kwargs.get("raw", False):
            self.full_clean()
        return super().save(*args, **kwargs)

    def clean(self):
        """Tolak perpindahan tenant dan relasi lintas tenant di level model."""

        super().clean()
        errors: dict[str, str] = {}
        if self.pk:
            original_tenant_id = (
                type(self)
                .objects.filter(pk=self.pk)
                .values_list("tenant_id", flat=True)
                .first()
            )
            if original_tenant_id is not None and original_tenant_id != self.tenant_id:
                errors["tenant"] = "Pemilik konveksi tidak dapat dipindahkan."

        for field in self._meta.concrete_fields:
            if not field.is_relation or not field.many_to_one or field.name == "tenant":
                continue
            related_id = getattr(self, field.attname, None)
            if related_id is None:
                continue
            related_model = field.remote_field.model
            if not any(
                candidate.name == "tenant" for candidate in related_model._meta.fields
            ):
                continue
            related_tenant_id = (
                related_model.objects.filter(pk=related_id)
                .values_list("tenant_id", flat=True)
                .first()
            )
            if related_tenant_id is not None and related_tenant_id != self.tenant_id:
                errors[field.name] = "Objek terkait berasal dari konveksi lain."

        if errors:
            raise ValidationError(errors)


class Customer(BaseModel):
    name = models.CharField("Nama Pelanggan", max_length=255)
    phone = models.CharField("Telepon", max_length=30, blank=True, default="")
    email = models.EmailField("Email", blank=True, default="")
    address = models.TextField("Alamat", blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_customer"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CustomerAddress(BaseModel):
    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="addresses"
    )
    label = models.CharField(max_length=80, default="Utama")
    recipient_name = models.CharField(max_length=255, blank=True, default="")
    phone = models.CharField(max_length=30, blank=True, default="")
    address = models.TextField()
    is_primary = models.BooleanField(default=False)

    class Meta:
        db_table = "masterdata_customer_address"

    def __str__(self):
        return f"{self.customer} — {self.label}"


class Supplier(BaseModel):
    name = models.CharField("Nama Pemasok", max_length=255)
    contact_person = models.CharField(
        "Kontak Person", max_length=100, blank=True, default=""
    )
    phone = models.CharField("Telepon", max_length=30, blank=True, default="")
    email = models.EmailField("Email", blank=True, default="")
    address = models.TextField("Alamat", blank=True, default="")
    payment_info = models.TextField("Info Pembayaran", blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_supplier"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Operator(BaseModel):
    class OperatorType(models.TextChoices):
        PENJAHIT = "penjahit", "Penjahit"
        MAKLON = "maklon", "Maklon (Luar)"
        POTONG = "potong", "Tukang Potong"
        SABLON = "sablon", "Tukang Sablon"
        GUDANG = "gudang", "Petugas Gudang"
        PEMBELIAN = "pembelian", "Petugas Pembelian"
        QC = "qc", "Petugas QC"
        PACKING = "packing", "Petugas Packing"
        MANDOR = "mandor", "Mandor"
        DAPUR = "dapur", "Petugas Dapur"

    class OperatorStatus(models.TextChoices):
        INTERNAL = "internal", "Internal"
        EXTERNAL = "external", "Eksternal (Luar)"

    name = models.CharField("Nama Operator", max_length=255)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="operator_profiles",
    )
    supervisor = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="team_members",
        null=True,
        blank=True,
    )
    operator_type = models.CharField(
        "Tipe", max_length=30, choices=OperatorType.choices
    )
    status = models.CharField(
        "Status",
        max_length=20,
        choices=OperatorStatus.choices,
        default=OperatorStatus.INTERNAL,
    )
    location = models.CharField("Lokasi Kerja", max_length=100, blank=True, default="")
    phone = models.CharField("Telepon", max_length=30, blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_operator"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user"],
                condition=models.Q(user__isnull=False),
                name="uniq_operator_user_per_tenant",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.get_operator_type_display()})"


class UOM(BaseModel):
    class Dimension(models.TextChoices):
        COUNT = "count", "Jumlah"
        LENGTH = "length", "Panjang"
        MASS = "mass", "Berat"
        VOLUME = "volume", "Volume"

    code = models.CharField("Kode Satuan", max_length=20)
    name = models.CharField("Nama Satuan", max_length=50)
    dimension = models.CharField(
        "Dimensi", max_length=20, choices=Dimension.choices, default=Dimension.COUNT
    )

    class Meta:
        db_table = "masterdata_uom"
        unique_together = [("tenant", "code")]

    def __str__(self):
        return self.code


class Material(BaseModel):
    code = models.CharField("Kode Material", max_length=50)
    name = models.CharField("Nama Material", max_length=255)
    purchase_uom = models.ForeignKey(
        UOM, on_delete=models.RESTRICT, related_name="+", verbose_name="Satuan Beli"
    )
    usage_uom = models.ForeignKey(
        UOM, on_delete=models.RESTRICT, related_name="+", verbose_name="Satuan Pakai"
    )
    conversion_ratio = models.DecimalField(
        "Rasio Konversi (Beli -> Pakai)",
        max_digits=12,
        decimal_places=4,
        validators=[MinValueValidator(Decimal("0.0001"))],
    )
    package_quantity = models.DecimalField(
        "Isi per Kemasan", max_digits=15, decimal_places=4, default=1
    )
    moq = models.DecimalField(
        "MOQ Beli", max_digits=10, decimal_places=2, default=Decimal("1")
    )
    purchase_multiple = models.DecimalField(
        "Kelipatan Beli", max_digits=10, decimal_places=2, default=Decimal("1")
    )
    shrinkage_percent = models.DecimalField(
        "Persentase Waste/Shrinkage",
        max_digits=5,
        decimal_places=2,
        default=Decimal("0"),
    )
    default_supplier = models.ForeignKey(
        Supplier, on_delete=models.SET_NULL, null=True, blank=True
    )
    last_purchase_price = models.DecimalField(
        "Harga Beli Terakhir",
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_material"
        unique_together = [("tenant", "code")]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def _has_conversion_usage(self) -> bool:
        related_models = [
            ("masterdata", "BOMItem"),
            ("inventory", "MaterialLedger"),
            ("inventory", "PurchaseRequest"),
            ("inventory", "PurchaseOrderLine"),
            ("production", "MaterialRequirement"),
        ]
        return any(
            apps.get_model(app_label, model_name)
            .objects.filter(tenant_id=self.tenant_id, material_id=self.pk)
            .exists()
            for app_label, model_name in related_models
        )

    def clean(self):
        super().clean()
        errors: dict[str, str] = {}
        self.name = (self.name or "").strip()

        if not self.name:
            errors["name"] = "Nama material wajib diisi."
        elif (
            Material.objects.filter(tenant_id=self.tenant_id, name__iexact=self.name)
            .exclude(pk=self.pk)
            .exists()
        ):
            errors["name"] = "Nama material sudah digunakan."

        if self.package_quantity is None or self.package_quantity <= Decimal("0"):
            errors["package_quantity"] = "Isi kemasan wajib lebih dari 0."
        if self.moq is None or self.moq <= Decimal("0"):
            errors["moq"] = "Minimal pembelian wajib lebih dari 0."
        if self.purchase_multiple is None or self.purchase_multiple <= Decimal("0"):
            errors["purchase_multiple"] = "Kelipatan beli wajib lebih dari 0."
        if self.shrinkage_percent is None or self.shrinkage_percent < Decimal("0"):
            errors["shrinkage_percent"] = "Waste/shrinkage wajib minimal 0%."
        elif self.shrinkage_percent > Decimal("100"):
            errors["shrinkage_percent"] = "Waste/shrinkage maksimal 100%."
        if self.last_purchase_price is not None and self.last_purchase_price < Decimal("0"):
            errors["last_purchase_price"] = "Harga beli terakhir wajib minimal 0."

        if (
            self.purchase_uom_id
            and self.usage_uom_id
            and self.purchase_uom_id == self.usage_uom_id
            and self.package_quantity != Decimal("1")
        ):
            errors["package_quantity"] = (
                "Isi kemasan harus 1 jika satuan pembelian sama dengan satuan penggunaan."
            )

        if self.default_supplier_id:
            supplier = Supplier.objects.filter(
                id=self.default_supplier_id, tenant_id=self.tenant_id
            ).first()
            if supplier is not None and not supplier.is_active:
                errors["default_supplier"] = "Supplier default harus aktif."

        if self.pk:
            original = (
                Material.objects.filter(pk=self.pk)
                .values(
                    "purchase_uom_id",
                    "usage_uom_id",
                    "package_quantity",
                    "conversion_ratio",
                )
                .first()
            )
            conversion_changed = original is not None and any(
                [
                    original["purchase_uom_id"] != self.purchase_uom_id,
                    original["usage_uom_id"] != self.usage_uom_id,
                    original["package_quantity"] != self.package_quantity,
                    original["conversion_ratio"] != self.conversion_ratio,
                ]
            )
            if conversion_changed and self._has_conversion_usage():
                errors["package_quantity"] = (
                    "Satuan dan isi kemasan tidak dapat diubah setelah material "
                    "dipakai pada BOM, pembelian, stok, atau SPK."
                )

        if errors:
            raise ValidationError(errors)


class ProductModel(BaseModel):
    code = models.CharField("Kode Model", max_length=50)
    name = models.CharField("Nama Model", max_length=255)
    description = models.TextField("Deskripsi", blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_product_model"
        unique_together = [("tenant", "code")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(code__regex=PRODUCT_MODEL_CODE_PATTERN),
                name="masterdata_product_model_code_format",
            )
        ]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        errors: dict[str, str] = {}
        try:
            normalized_code = normalize_sku_segment(self.code)
        except ValueError as exc:
            errors["code"] = str(exc)
        else:
            if self.pk:
                original_code = (
                    type(self)
                    .objects.filter(pk=self.pk)
                    .values_list("code", flat=True)
                    .first()
                )
                has_variants = self.variants.exists()
                if original_code != normalized_code and has_variants:
                    errors["code"] = (
                        "Kode model tidak dapat diubah setelah varian produk dibuat."
                    )
            self.code = normalized_code

        if errors:
            raise ValidationError(errors)


class ProductVariant(BaseModel):
    product_model = models.ForeignKey(
        ProductModel, on_delete=models.CASCADE, related_name="variants"
    )
    sku = models.CharField("SKU", max_length=100, blank=True, default="")
    color = models.CharField("Warna", max_length=50, blank=True, default="")
    size = models.CharField("Ukuran", max_length=20, blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)
    metadata = models.JSONField("Metadata", default=dict, blank=True)
    default_margin_percent = models.DecimalField(
        max_digits=7, decimal_places=2, null=True, blank=True
    )

    class Meta:
        db_table = "masterdata_product_variant"
        unique_together = [("tenant", "sku")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(sku__regex=PRODUCT_VARIANT_SKU_PATTERN),
                name="masterdata_product_variant_sku_format",
            )
        ]

    def __str__(self):
        return self.sku

    def clean(self):
        super().clean()
        errors: dict[str, str] = {}
        self.color = self.color.strip()
        self.size = self.size.strip()
        product_model_code = None
        if self.product_model_id:
            product_model_code = (
                ProductModel.objects.filter(pk=self.product_model_id)
                .values_list("code", flat=True)
                .first()
            )
        if product_model_code is not None:
            try:
                self.sku = build_product_variant_sku(
                    product_model_code, self.color, self.size
                )
            except ValueError as exc:
                errors["sku"] = str(exc)

        if errors:
            raise ValidationError(errors)


class BOM(BaseModel):
    product_variant = models.ForeignKey(
        ProductVariant, on_delete=models.CASCADE, related_name="boms"
    )
    version = models.PositiveIntegerField("Versi", default=1)
    effective_date = models.DateField("Tanggal Efektif")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_bom"
        unique_together = [("tenant", "product_variant", "version")]

    def __str__(self):
        return f"BOM {self.product_variant.sku} v{self.version}"


class BOMItem(BaseModel):
    bom = models.ForeignKey(BOM, on_delete=models.CASCADE, related_name="items")
    material = models.ForeignKey(Material, on_delete=models.RESTRICT)
    quantity = models.DecimalField(
        "Kuantitas (Satuan Pakai)", max_digits=12, decimal_places=4
    )

    class Meta:
        db_table = "masterdata_bom_item"

    def __str__(self):
        return f"{self.bom}: {self.material}"


class Routing(BaseModel):
    product_model = models.ForeignKey(
        ProductModel, on_delete=models.CASCADE, related_name="routings"
    )
    version = models.PositiveIntegerField("Versi", default=1)
    effective_date = models.DateField("Tanggal Efektif")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_routing"
        unique_together = [("tenant", "product_model", "version")]

    def __str__(self):
        return f"Routing {self.product_model} v{self.version}"


class RoutingStage(BaseModel):
    routing = models.ForeignKey(
        Routing, on_delete=models.CASCADE, related_name="stages"
    )
    sequence = models.PositiveIntegerField("Urutan")
    stage_name = models.CharField(
        "Nama Tahap", max_length=100
    )  # e.g., Potong, Sablon, Jahit, QC
    transition_rule = models.JSONField("Aturan Perpindahan", default=dict, blank=True)
    requires_qc = models.BooleanField(default=False)

    class Meta:
        db_table = "masterdata_routing_stage"
        ordering = ["sequence"]

    def __str__(self):
        return f"{self.routing}: {self.sequence}. {self.stage_name}"


class PieceRate(BaseModel):
    operator = models.ForeignKey(
        Operator,
        on_delete=models.CASCADE,
        related_name="piece_rates",
        null=True,
        blank=True,
    )
    product_model = models.ForeignKey(ProductModel, on_delete=models.CASCADE)
    stage_name = models.CharField("Nama Tahap (Routing)", max_length=100)
    rate_amount = models.DecimalField("Tarif", max_digits=15, decimal_places=2)
    effective_date = models.DateField("Tanggal Efektif")
    effective_end_date = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=100, blank=True, default="")
    operator_status = models.CharField(
        max_length=20, choices=Operator.OperatorStatus.choices, blank=True, default=""
    )
    change_reason = models.TextField(blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_piece_rate"
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "tenant",
                    "product_model",
                    "stage_name",
                    "effective_date",
                    "location",
                    "operator_status",
                ],
                condition=models.Q(operator__isnull=True),
                name="uniq_piece_rate_default_version",
            ),
            models.UniqueConstraint(
                fields=[
                    "tenant",
                    "product_model",
                    "stage_name",
                    "effective_date",
                    "operator",
                    "location",
                    "operator_status",
                ],
                condition=models.Q(operator__isnull=False),
                name="uniq_piece_rate_operator_version",
            ),
        ]

    def __str__(self):
        return f"{self.product_model} / {self.stage_name}: {self.rate_amount}"


class ChartOfAccount(BaseModel):
    class AccountType(models.TextChoices):
        ASSET = "asset", "Asset"
        LIABILITY = "liability", "Liability"
        EQUITY = "equity", "Equity"
        REVENUE = "revenue", "Revenue"
        EXPENSE = "expense", "Expense"

    code = models.CharField("Kode Akun", max_length=20)
    name = models.CharField("Nama Akun", max_length=200)
    account_type = models.CharField(
        "Tipe Akun", max_length=20, choices=AccountType.choices
    )
    is_active = models.BooleanField("Aktif", default=True)

    class Meta:
        db_table = "masterdata_coa"
        unique_together = [("tenant", "code")]

    def __str__(self):
        return f"{self.code} — {self.name}"


class BankAccount(BaseModel):
    name = models.CharField(max_length=150)
    bank_name = models.CharField(max_length=100, blank=True, default="")
    account_number = models.CharField(max_length=100, blank=True, default="")
    account_holder = models.CharField(max_length=150, blank=True, default="")
    chart_account = models.ForeignKey(
        ChartOfAccount, on_delete=models.RESTRICT, null=True, blank=True
    )
    is_cash = models.BooleanField(default=False)
    is_petty_cash = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "masterdata_bank_account"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "name"], name="uniq_account_name")
        ]

    def __str__(self):
        return self.name


class CostCategory(BaseModel):
    class AllocationBasis(models.TextChoices):
        QUANTITY = "quantity", "Jumlah Produk"
        DIRECT_COST = "direct_cost", "Biaya Langsung"
        MANUAL = "manual", "Manual"

    code = models.CharField(max_length=40)
    name = models.CharField(max_length=150)
    allocation_basis = models.CharField(
        max_length=30, choices=AllocationBasis.choices, default=AllocationBasis.QUANTITY
    )
    expense_account = models.ForeignKey(
        ChartOfAccount, on_delete=models.RESTRICT, null=True, blank=True
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "masterdata_cost_category"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"], name="uniq_cost_category"
            )
        ]

    def __str__(self):
        return f"{self.code} — {self.name}"
