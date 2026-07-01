from django.db import models

from backend.masterdata.models import BaseModel, ChartOfAccount


class AccountingPeriod(BaseModel):
    class Status(models.TextChoices):
        OPEN = "open", "Terbuka"
        CLOSING = "closing", "Proses Tutup Buku"
        CLOSED = "closed", "Ditutup"
        REOPENED = "reopened", "Dibuka Kembali"

    name = models.CharField("Nama Periode", max_length=50)  # e.g. "Januari 2026"
    start_date = models.DateField("Tanggal Mulai")
    end_date = models.DateField("Tanggal Berakhir")
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.OPEN
    )
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        "core.User",
        on_delete=models.PROTECT,
        related_name="closed_periods",
        null=True,
        blank=True,
    )
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopened_by = models.ForeignKey(
        "core.User",
        on_delete=models.PROTECT,
        related_name="reopened_periods",
        null=True,
        blank=True,
    )
    reopen_reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "accounting_period"
        unique_together = [("tenant", "start_date", "end_date")]


class JournalEntry(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft Otomatis/Manual"
        POSTED = "posted", "Posted"
        REVERSED = "reversed", "Reversed"

    period = models.ForeignKey(
        AccountingPeriod, on_delete=models.RESTRICT, related_name="journals"
    )
    date = models.DateField("Tanggal Jurnal")
    description = models.CharField("Keterangan", max_length=255)
    reference = models.CharField(
        "Referensi Sumber", max_length=100, blank=True, default=""
    )
    status = models.CharField(
        "Status", max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    entry_number = models.CharField(max_length=50, blank=True, default="")
    is_automatic = models.BooleanField(default=False)
    source_type = models.CharField(max_length=100, blank=True, default="")
    source_id = models.CharField(max_length=200, blank=True, default="")
    created_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    reversed_by_entry = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        related_name="reversal_of",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "accounting_journal_entry"


class JournalLine(BaseModel):
    journal = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name="lines"
    )
    account = models.ForeignKey(ChartOfAccount, on_delete=models.RESTRICT)
    description = models.CharField(
        "Keterangan Baris", max_length=255, blank=True, default=""
    )
    debit = models.DecimalField("Debit", max_digits=15, decimal_places=2, default=0)
    credit = models.DecimalField("Kredit", max_digits=15, decimal_places=2, default=0)

    class Meta:
        db_table = "accounting_journal_line"
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(debit__gt=0, credit=0) | models.Q(credit__gt=0, debit=0)
                ),
                name="journal_line_one_side",
            )
        ]


class AccountingMapping(BaseModel):
    """Mapping transaksi operasional ke akun debit/kredit per tenant."""

    event_type = models.CharField(max_length=100)
    debit_account = models.ForeignKey(
        ChartOfAccount, on_delete=models.RESTRICT, related_name="debit_mappings"
    )
    credit_account = models.ForeignKey(
        ChartOfAccount, on_delete=models.RESTRICT, related_name="credit_mappings"
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "accounting_mapping"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "event_type"], name="uniq_accounting_mapping"
            )
        ]


class ReconciliationIssue(BaseModel):
    class Status(models.TextChoices):
        OPEN = "open", "Terbuka"
        RESOLVED = "resolved", "Selesai"

    source_type = models.CharField(max_length=100)
    source_id = models.CharField(max_length=200)
    issue_type = models.CharField(max_length=80)
    detail = models.JSONField(default=dict)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounting_reconciliation_issue"
