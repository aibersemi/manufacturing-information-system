"""Workflow absensi, hasil borongan, kasbon, dan pembayaran operator."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from backend.accounting.services import create_operational_journal
from backend.core.models import Tenant, User
from backend.core.services import next_document_number, record_audit
from backend.labor.models import (
    Attendance,
    CashAdvance,
    CashAdvanceSettlement,
    PieceRatePayment,
    PieceRatePaymentItem,
)
from backend.masterdata.models import BankAccount, Operator
from backend.production.models import OperatorWorkLog


@transaction.atomic
def record_own_attendance(
    *,
    tenant: Tenant,
    user: User,
    attendance_date: date,
    is_present: bool,
    notes: str = "",
) -> Attendance:
    operator = Operator.objects.filter(tenant=tenant, user=user, is_active=True).first()
    if operator is None:
        raise PermissionError("Akun belum terhubung dengan profil operator.")
    attendance, _created = Attendance.objects.update_or_create(
        tenant=tenant,
        operator=operator,
        date=attendance_date,
        defaults={
            "is_present": is_present,
            "meal_eligible": is_present,
            "notes": notes,
        },
    )
    return attendance


@transaction.atomic
def pay_piece_rate(
    *,
    tenant: Tenant,
    operator: Operator,
    work_log_ids: list[str],
    paid_rates: dict[str, Decimal],
    adjustment_reasons: dict[str, str],
    account: BankAccount,
    user: User,
    proof_id: str,
) -> PieceRatePayment:
    logs = list(
        OperatorWorkLog.objects.select_for_update().filter(
            tenant=tenant,
            operator=operator,
            id__in=work_log_ids,
            is_verified=True,
            is_paid=False,
        )
    )
    if len(logs) != len(set(work_log_ids)) or not logs:
        raise ValueError(
            "Hasil kerja tidak valid, belum diverifikasi, atau sudah dibayar."
        )
    gross = Decimal("0")
    item_values = []
    for log in logs:
        paid_rate = Decimal(str(paid_rates.get(str(log.id), log.piece_rate_applied)))
        reason = adjustment_reasons.get(str(log.id), "")
        if paid_rate != log.piece_rate_applied and not reason:
            raise ValueError("Perubahan tarif pembayaran wajib memiliki alasan.")
        amount = paid_rate * log.qty_claimed
        gross += amount
        item_values.append((log, paid_rate, reason, amount))

    open_advances = list(
        CashAdvance.objects.select_for_update()
        .filter(tenant=tenant, operator=operator, is_paid=False, remaining_amount__gt=0)
        .order_by("date", "created_at")
    )
    remaining_gross = gross
    deductions: list[tuple[CashAdvance, Decimal]] = []
    for advance in open_advances:
        if remaining_gross <= 0:
            break
        deduction = min(remaining_gross, advance.remaining_amount)
        deductions.append((advance, deduction))
        remaining_gross -= deduction
    total_deduction = gross - remaining_gross
    payment = PieceRatePayment.objects.create(
        tenant=tenant,
        operator=operator,
        date=timezone.localdate(),
        gross_amount=gross,
        cash_advance_deduction=total_deduction,
        net_paid=remaining_gross,
        payment_reference=next_document_number(tenant, "BOR"),
        payment_account=account,
        proof_id=proof_id,
        paid_by=user,
    )
    for log, paid_rate, reason, amount in item_values:
        PieceRatePaymentItem.objects.create(
            tenant=tenant,
            payment=payment,
            work_log=log,
            quantity=log.qty_claimed,
            reference_rate=log.piece_rate_applied,
            paid_rate=paid_rate,
            gross_amount=amount,
            adjustment_reason=reason,
        )
        payment.work_logs.add(log)
        log.is_paid = True
        log.rate_adjustment_reason = reason
        log.save(update_fields=["is_paid", "rate_adjustment_reason", "updated_at"])
    for advance, deduction in deductions:
        CashAdvanceSettlement.objects.create(
            tenant=tenant,
            payment=payment,
            cash_advance=advance,
            amount=deduction,
        )
        payment.settled_advances.add(advance)
        advance.remaining_amount -= deduction
        advance.is_paid = advance.remaining_amount == 0
        advance.save(update_fields=["remaining_amount", "is_paid", "updated_at"])
    if payment.net_paid > 0:
        create_operational_journal(
            tenant=tenant,
            event_type="labor.piece_rate_payment",
            amount=payment.net_paid,
            journal_date=payment.date,
            source_type="PieceRatePayment",
            source_id=str(payment.id),
            description=f"Pembayaran borongan {operator.name}",
            final=True,
            user=user,
        )
    record_audit(
        tenant=tenant,
        user=user,
        action="piece_rate_paid",
        resource_type="PieceRatePayment",
        resource_id=payment.id,
        after={
            "operator": operator.id,
            "gross": gross,
            "cash_advance_deduction": total_deduction,
            "net_paid": payment.net_paid,
            "items": work_log_ids,
        },
    )
    return payment
