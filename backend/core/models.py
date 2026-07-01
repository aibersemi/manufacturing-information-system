"""
Foundation models untuk Manufacturing Information System.

Model-model ini adalah fondasi yang diperlukan sebelum modul bisnis
(PO, produksi, inventory, finance) dibangun.
"""

import uuid

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models


class User(AbstractUser):
    """
    Custom User model — ditetapkan sebagai AUTH_USER_MODEL sejak awal
    agar bisa di-extend nanti tanpa migrasi berat.

    Saat ini hanya mewarisi AbstractUser. Field tambahan (tenant default,
    avatar, phone, dll) akan ditambahkan sesuai kebutuhan fitur.
    """

    class Meta:
        db_table = "core_user"
        verbose_name = "Pengguna"
        verbose_name_plural = "Pengguna"

    def __str__(self):
        return self.get_full_name() or self.username


class Tenant(models.Model):
    """
    Representasi satu konveksi/perusahaan.
    Setiap transaksi dan data bisnis wajib memiliki scope tenant
    untuk memastikan isolasi data antar-konveksi.
    """

    name = models.CharField("Nama Konveksi", max_length=200)
    slug = models.SlugField("Slug", max_length=100, unique=True)
    code = models.CharField("Kode Dokumen", max_length=12, blank=True, default="")
    address = models.TextField("Alamat", blank=True, default="")
    phone = models.CharField("Telepon", max_length=30, blank=True, default="")
    is_active = models.BooleanField("Aktif", default=True)
    created_at = models.DateTimeField("Dibuat", auto_now_add=True)
    updated_at = models.DateTimeField("Diperbarui", auto_now=True)

    class Meta:
        db_table = "core_tenant"
        verbose_name = "Konveksi"
        verbose_name_plural = "Konveksi"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Membership(models.Model):
    """
    Keanggotaan user di tenant dengan role.

    Satu user bisa menjadi member di beberapa tenant (misalnya
    Super Admin atau Finance yang mengelola beberapa konveksi).
    """

    class Role(models.TextChoices):
        SUPER_ADMIN = "super_admin", "Super Admin"
        KEPALA_KONVEKSI = "kepala_konveksi", "Kepala Konveksi"
        FINANCE = "finance", "Finance"
        OPERATOR = "operator", "Operator"

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="memberships",
        verbose_name="Pengguna",
    )
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="memberships",
        verbose_name="Konveksi",
    )
    role = models.CharField(
        "Peran",
        max_length=30,
        choices=Role.choices,
        default=Role.OPERATOR,
    )
    is_active = models.BooleanField("Aktif", default=True)
    created_at = models.DateTimeField("Dibuat", auto_now_add=True)

    class Meta:
        db_table = "core_membership"
        verbose_name = "Keanggotaan"
        verbose_name_plural = "Keanggotaan"
        unique_together = [("user", "tenant")]

    def __str__(self):
        return f"{self.user} — {self.tenant} ({self.get_role_display()})"

    def save(self, *args, **kwargs):
        if not kwargs.get("raw", False):
            self.full_clean()
        return super().save(*args, **kwargs)

    def clean(self):
        """Jaga satu role aktif dan batas tenant untuk role operasional."""

        super().clean()
        if not self.is_active or not self.user_id:
            return

        memberships = Membership.objects.filter(user_id=self.user_id, is_active=True)
        if self.pk:
            memberships = memberships.exclude(pk=self.pk)

        if memberships.exclude(role=self.role).exists():
            raise ValidationError(
                {"role": "Role aktif pengguna harus konsisten di semua konveksi."}
            )

        single_tenant_roles = {
            self.Role.KEPALA_KONVEKSI,
            self.Role.OPERATOR,
        }
        if self.role in single_tenant_roles and memberships.exists():
            raise ValidationError(
                {"tenant": "Role ini hanya boleh aktif pada satu konveksi."}
            )
        if memberships.filter(role__in=single_tenant_roles).exists():
            raise ValidationError(
                {"tenant": "Pengguna memiliki role yang dikunci pada satu konveksi."}
            )


class AuditEvent(models.Model):
    """
    Audit trail untuk aktivitas penting.

    Mencatat: siapa, kapan, di konveksi mana, melakukan apa,
    pada resource apa, dan detail perubahan (before/after).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
        verbose_name="Konveksi",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
        verbose_name="Pengguna",
    )
    action = models.CharField("Aksi", max_length=100)
    resource_type = models.CharField("Tipe Resource", max_length=100)
    resource_id = models.CharField(
        "ID Resource", max_length=200, blank=True, default=""
    )
    detail = models.JSONField("Detail", default=dict, blank=True)
    ip_address = models.GenericIPAddressField("Alamat IP", null=True, blank=True)
    request_id = models.CharField("Request ID", max_length=128, blank=True, default="")
    created_at = models.DateTimeField("Dibuat", auto_now_add=True, db_index=True)

    class Meta:
        db_table = "core_audit_event"
        verbose_name = "Audit Event"
        verbose_name_plural = "Audit Events"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.action}] {self.resource_type}:{self.resource_id}"


class OutboxEvent(models.Model):
    """
    Transactional outbox untuk sinkronisasi search (Meilisearch).

    Perubahan data dicatat di outbox setelah database commit,
    lalu diproses secara idempotent oleh Dramatiq worker.
    """

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="outbox_events",
    )
    event_type = models.CharField("Tipe Event", max_length=100)
    payload = models.JSONField("Payload", default=dict)
    deduplication_key = models.CharField(
        "Kunci Idempotensi", max_length=200, blank=True, default="", db_index=True
    )
    is_processed = models.BooleanField("Sudah Diproses", default=False, db_index=True)
    processed_at = models.DateTimeField("Diproses Pada", null=True, blank=True)
    created_at = models.DateTimeField("Dibuat", auto_now_add=True, db_index=True)
    retry_count = models.PositiveIntegerField("Jumlah Retry", default=0)

    class Meta:
        db_table = "core_outbox_event"
        verbose_name = "Outbox Event"
        verbose_name_plural = "Outbox Events"
        ordering = ["created_at"]

    def __str__(self):
        status = "✓" if self.is_processed else "…"
        return f"[{status}] {self.event_type}"


class DocumentSequence(models.Model):
    """
    Counter nomor dokumen per tenant, jenis dokumen, dan periode.

    Format tampilan dokumen dibangun oleh service layer, tetapi counter
    disimpan terpusat agar endpoint bisnis nanti bisa menjaga urutan atomik.
    """

    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name="document_sequences",
        verbose_name="Konveksi",
    )
    document_type = models.CharField("Jenis Dokumen", max_length=30)
    period = models.CharField("Periode YYYYMM", max_length=6)
    current_number = models.PositiveIntegerField("Nomor Saat Ini", default=0)
    created_at = models.DateTimeField("Dibuat", auto_now_add=True)
    updated_at = models.DateTimeField("Diperbarui", auto_now=True)

    class Meta:
        db_table = "core_document_sequence"
        verbose_name = "Document Sequence"
        verbose_name_plural = "Document Sequences"
        unique_together = [("tenant", "document_type", "period")]
        ordering = ["tenant", "document_type", "period"]

    def __str__(self):
        return f"{self.tenant}:{self.document_type}:{self.period}={self.current_number}"


class FileMetadata(models.Model):
    """
    Metadata file bisnis yang tersimpan di MEDIA_ROOT tenant-scoped.

    File tidak diidentifikasi dari nama asli. Path tersimpan wajib path internal
    hasil aplikasi agar akses tenant dan arsip bisa diaudit.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.PROTECT,
        related_name="files",
        verbose_name="Konveksi",
    )
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_files",
        verbose_name="Diunggah Oleh",
    )
    category = models.CharField("Kategori", max_length=50)
    resource_type = models.CharField(
        "Tipe Dokumen", max_length=100, blank=True, default=""
    )
    resource_id = models.CharField("ID Dokumen", max_length=200, blank=True, default="")
    original_filename = models.CharField("Nama File Asli", max_length=255)
    stored_path = models.CharField("Path Internal", max_length=500, unique=True)
    content_type = models.CharField("Content Type", max_length=120)
    size_bytes = models.PositiveBigIntegerField("Ukuran Bytes")
    checksum_sha256 = models.CharField("SHA-256", max_length=64, blank=True, default="")
    metadata = models.JSONField("Metadata", default=dict, blank=True)
    is_archived = models.BooleanField("Diarsipkan", default=False, db_index=True)
    archived_at = models.DateTimeField("Diarsipkan Pada", null=True, blank=True)
    created_at = models.DateTimeField("Dibuat", auto_now_add=True, db_index=True)

    class Meta:
        db_table = "core_file_metadata"
        verbose_name = "File Metadata"
        verbose_name_plural = "File Metadata"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tenant}:{self.category}:{self.original_filename}"


class BusinessPolicy(models.Model):
    """Kebijakan approval dan parameter bisnis yang dapat diaudit per tenant."""

    tenant = models.OneToOneField(
        Tenant, on_delete=models.CASCADE, related_name="business_policy"
    )
    default_margin_percent = models.DecimalField(
        "Margin Default (%)", max_digits=7, decimal_places=2, default=20
    )
    significant_scrap_quantity = models.DecimalField(
        "Batas Scrap Signifikan", max_digits=15, decimal_places=4, default=100
    )
    significant_adjustment_value = models.DecimalField(
        "Batas Nilai Adjustment Signifikan",
        max_digits=18,
        decimal_places=2,
        default=5_000_000,
    )
    material_alert_escalation_hours = models.PositiveIntegerField(default=24)
    payment_alert_escalation_hours = models.PositiveIntegerField(default=24)
    telegram_chat_ids = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "core_business_policy"

    def __str__(self):
        return f"Kebijakan {self.tenant}"


class ApprovalRequest(models.Model):
    """Approval generik untuk aksi signifikan tanpa mengubah transaksi sumber."""

    class Status(models.TextChoices):
        PENDING = "pending", "Menunggu"
        APPROVED = "approved", "Disetujui"
        REJECTED = "rejected", "Ditolak"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.PROTECT, related_name="approvals"
    )
    action_type = models.CharField(max_length=80)
    resource_type = models.CharField(max_length=100)
    resource_id = models.CharField(max_length=200)
    reason = models.TextField()
    payload = models.JSONField(default=dict, blank=True)
    requested_by = models.ForeignKey(
        User, on_delete=models.PROTECT, related_name="requested_approvals"
    )
    reviewed_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="reviewed_approvals",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    review_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "core_approval_request"
        indexes = [models.Index(fields=["tenant", "status", "action_type"])]

    def __str__(self):
        return f"{self.action_type}: {self.resource_type}:{self.resource_id}"


class Notification(models.Model):
    """Notifikasi in-app dan status delivery Telegram yang idempotent."""

    class Channel(models.TextChoices):
        IN_APP = "in_app", "In-app"
        TELEGRAM = "telegram", "Telegram"

    class Status(models.TextChoices):
        PENDING = "pending", "Menunggu"
        SENT = "sent", "Terkirim"
        FAILED = "failed", "Gagal"
        READ = "read", "Dibaca"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.CASCADE, related_name="notifications"
    )
    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="notifications",
        null=True,
        blank=True,
    )
    event_type = models.CharField(max_length=80)
    channel = models.CharField(max_length=20, choices=Channel.choices)
    title = models.CharField(max_length=200)
    message = models.TextField()
    safe_path = models.CharField(max_length=500, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    deduplication_key = models.CharField(max_length=200)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    attempt_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "core_notification"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "channel", "deduplication_key"],
                name="uniq_notification_delivery",
            )
        ]

    def __str__(self):
        return f"{self.channel}: {self.title}"


class ExportJob(models.Model):
    """Job ekspor besar yang diproses worker dan selalu tenant-scoped."""

    class Status(models.TextChoices):
        PENDING = "pending", "Menunggu"
        PROCESSING = "processing", "Diproses"
        COMPLETED = "completed", "Selesai"
        FAILED = "failed", "Gagal"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.CASCADE, related_name="export_jobs"
    )
    requested_by = models.ForeignKey(User, on_delete=models.PROTECT)
    report_type = models.CharField(max_length=80)
    filters = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    file = models.ForeignKey(
        FileMetadata, on_delete=models.PROTECT, null=True, blank=True
    )
    error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "core_export_job"

    def __str__(self):
        return f"{self.report_type}: {self.status}"
