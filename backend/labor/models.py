from django.db import models

from backend.masterdata.models import BaseModel, Operator
from backend.production.models import OperatorWorkLog


class Attendance(BaseModel):
    operator = models.ForeignKey(
        Operator, on_delete=models.CASCADE, related_name="attendances"
    )
    date = models.DateField("Tanggal Absensi")
    is_present = models.BooleanField("Hadir", default=True)
    meal_eligible = models.BooleanField(default=False)
    notes = models.TextField("Catatan", blank=True, default="")

    class Meta:
        db_table = "labor_attendance"
        unique_together = [("tenant", "operator", "date")]


class CashAdvance(BaseModel):
    operator = models.ForeignKey(
        Operator, on_delete=models.CASCADE, related_name="cash_advances"
    )
    date = models.DateField("Tanggal Kasbon")
    amount = models.DecimalField("Nominal", max_digits=15, decimal_places=2)
    remaining_amount = models.DecimalField(
        "Sisa Belum Lunas", max_digits=15, decimal_places=2
    )
    is_paid = models.BooleanField("Sudah Lunas", default=False)
    notes = models.TextField("Alasan / Catatan", blank=True, default="")
    created_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )

    class Meta:
        db_table = "labor_cash_advance"


class PieceRatePayment(BaseModel):
    operator = models.ForeignKey(
        Operator, on_delete=models.RESTRICT, related_name="payments"
    )
    date = models.DateField("Tanggal Pembayaran")
    gross_amount = models.DecimalField("Total Bruto", max_digits=15, decimal_places=2)
    cash_advance_deduction = models.DecimalField(
        "Potongan Kasbon", max_digits=15, decimal_places=2, default=0
    )
    net_paid = models.DecimalField("Total Dibayar", max_digits=15, decimal_places=2)
    payment_reference = models.CharField(
        "Referensi Pembayaran", max_length=100, blank=True, default=""
    )
    payment_account = models.ForeignKey(
        "masterdata.BankAccount", on_delete=models.RESTRICT, null=True, blank=True
    )
    proof = models.ForeignKey(
        "core.FileMetadata", on_delete=models.PROTECT, null=True, blank=True
    )
    paid_by = models.ForeignKey(
        "core.User", on_delete=models.PROTECT, null=True, blank=True
    )
    rate_adjustment_reason = models.TextField(blank=True, default="")

    # One payment settles many work logs and potentially multiple cash advances
    work_logs = models.ManyToManyField(OperatorWorkLog, related_name="settled_payments")
    settled_advances = models.ManyToManyField(
        CashAdvance, related_name="settled_by_payments", blank=True
    )

    class Meta:
        db_table = "labor_piece_rate_payment"


class PieceRatePaymentItem(BaseModel):
    payment = models.ForeignKey(
        PieceRatePayment, on_delete=models.PROTECT, related_name="items"
    )
    work_log = models.OneToOneField(
        OperatorWorkLog, on_delete=models.PROTECT, related_name="payment_item"
    )
    quantity = models.PositiveIntegerField()
    reference_rate = models.DecimalField(max_digits=18, decimal_places=2)
    paid_rate = models.DecimalField(max_digits=18, decimal_places=2)
    gross_amount = models.DecimalField(max_digits=18, decimal_places=2)
    adjustment_reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "labor_piece_rate_payment_item"


class CashAdvanceSettlement(BaseModel):
    payment = models.ForeignKey(
        PieceRatePayment, on_delete=models.PROTECT, related_name="advance_settlements"
    )
    cash_advance = models.ForeignKey(
        CashAdvance, on_delete=models.PROTECT, related_name="settlements"
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2)

    class Meta:
        db_table = "labor_cash_advance_settlement"
