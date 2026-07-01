"""Ledger accounting, period lock, posting otomatis, dan rekonsiliasi."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from backend.accounting.models import (
    AccountingMapping,
    AccountingPeriod,
    JournalEntry,
    JournalLine,
    ReconciliationIssue,
)
from backend.core.models import Membership, Tenant, User
from backend.core.services import next_document_number, record_audit
from backend.masterdata.models import ChartOfAccount


def period_for_date(tenant: Tenant, journal_date: date) -> AccountingPeriod:
    period = AccountingPeriod.objects.filter(
        tenant=tenant,
        start_date__lte=journal_date,
        end_date__gte=journal_date,
    ).first()
    if period is None:
        raise ValueError("Periode akuntansi untuk tanggal transaksi belum dibuat.")
    if period.status not in {
        AccountingPeriod.Status.OPEN,
        AccountingPeriod.Status.REOPENED,
    }:
        raise ValueError("Periode akuntansi sudah ditutup.")
    return period


@transaction.atomic
def create_journal(
    *,
    tenant: Tenant,
    journal_date: date,
    description: str,
    lines: list[dict],
    user: User | None,
    reference: str = "",
    is_automatic: bool = False,
    source_type: str = "",
    source_id: str = "",
    final: bool = False,
) -> JournalEntry:
    period = period_for_date(tenant, journal_date)
    debit = sum((Decimal(str(line.get("debit", 0))) for line in lines), Decimal("0"))
    credit = sum((Decimal(str(line.get("credit", 0))) for line in lines), Decimal("0"))
    if debit <= 0 or debit != credit:
        raise ValueError("Jurnal wajib seimbang dan bernilai lebih besar dari nol.")
    if len(lines) < 2:
        raise ValueError("Jurnal wajib memiliki sedikitnya dua baris.")

    entry = JournalEntry.objects.create(
        tenant=tenant,
        period=period,
        entry_number=next_document_number(tenant, "JRN", at=journal_date),
        date=journal_date,
        description=description,
        reference=reference,
        status=JournalEntry.Status.POSTED if final else JournalEntry.Status.DRAFT,
        is_automatic=is_automatic,
        source_type=source_type,
        source_id=source_id,
        created_by=user,
        posted_at=timezone.now() if final else None,
    )
    for line in lines:
        account = ChartOfAccount.objects.filter(
            tenant=tenant, pk=line["account_id"], is_active=True
        ).first()
        if account is None:
            raise ValueError("Akun jurnal tidak ditemukan pada konveksi aktif.")
        JournalLine.objects.create(
            tenant=tenant,
            journal=entry,
            account=account,
            description=line.get("description") or "",
            debit=Decimal(str(line.get("debit", 0))),
            credit=Decimal(str(line.get("credit", 0))),
        )
    record_audit(
        tenant=tenant,
        user=user,
        action="journal_created",
        resource_type="JournalEntry",
        resource_id=entry.id,
        after={
            "entry_number": entry.entry_number,
            "is_automatic": is_automatic,
            "status": entry.status,
            "debit": debit,
            "credit": credit,
        },
    )
    return entry


def create_operational_journal(
    *,
    tenant: Tenant,
    event_type: str,
    amount: Decimal,
    journal_date: date,
    source_type: str,
    source_id: str,
    description: str,
    final: bool,
    user: User | None,
) -> JournalEntry:
    existing = (
        JournalEntry.objects.filter(
            tenant=tenant,
            source_type=source_type,
            source_id=source_id,
            is_automatic=True,
        )
        .exclude(status=JournalEntry.Status.REVERSED)
        .first()
    )
    if existing:
        return existing
    mapping = (
        AccountingMapping.objects.select_related("debit_account", "credit_account")
        .filter(tenant=tenant, event_type=event_type, is_active=True)
        .first()
    )
    if mapping is None:
        ReconciliationIssue.objects.get_or_create(
            tenant=tenant,
            source_type=source_type,
            source_id=source_id,
            issue_type="missing_accounting_mapping",
            status=ReconciliationIssue.Status.OPEN,
            defaults={"detail": {"event_type": event_type, "amount": str(amount)}},
        )
        raise ValueError(f"Mapping akuntansi belum tersedia untuk {event_type}.")
    return create_journal(
        tenant=tenant,
        journal_date=journal_date,
        description=description,
        reference=f"{source_type}:{source_id}",
        is_automatic=True,
        source_type=source_type,
        source_id=source_id,
        final=final,
        user=user,
        lines=[
            {"account_id": mapping.debit_account_id, "debit": amount, "credit": 0},
            {"account_id": mapping.credit_account_id, "debit": 0, "credit": amount},
        ],
    )


def create_operational_journal_safe(**kwargs) -> JournalEntry | None:
    """Jaga transaksi sumber tetap sah sambil menandai kegagalan posting untuk rekonsiliasi."""
    try:
        return create_operational_journal(**kwargs)
    except ValueError as exc:
        ReconciliationIssue.objects.get_or_create(
            tenant=kwargs["tenant"],
            source_type=kwargs["source_type"],
            source_id=kwargs["source_id"],
            issue_type="journal_posting_failed",
            status=ReconciliationIssue.Status.OPEN,
            defaults={
                "detail": {
                    "event_type": kwargs["event_type"],
                    "amount": str(kwargs["amount"]),
                    "error": str(exc),
                }
            },
        )
        return None


@transaction.atomic
def reverse_journal(entry: JournalEntry, *, user: User, reason: str) -> JournalEntry:
    entry = (
        JournalEntry.objects.select_for_update()
        .prefetch_related("lines")
        .get(pk=entry.pk)
    )
    if entry.status != JournalEntry.Status.POSTED:
        raise ValueError("Hanya jurnal posted yang dapat dibalik.")
    if not reason:
        raise ValueError("Reversal jurnal wajib memiliki alasan.")
    reversal = create_journal(
        tenant=entry.tenant,
        journal_date=entry.date,
        description=f"Reversal: {entry.description}",
        reference=entry.entry_number or str(entry.id),
        is_automatic=entry.is_automatic,
        source_type="JournalEntry",
        source_id=str(entry.id),
        final=True,
        user=user,
        lines=[
            {
                "account_id": line.account_id,
                "description": reason,
                "debit": line.credit,
                "credit": line.debit,
            }
            for line in entry.lines.all()
        ],
    )
    entry.status = JournalEntry.Status.REVERSED
    entry.reversed_by_entry = reversal
    entry.save(update_fields=["status", "reversed_by_entry", "updated_at"])
    record_audit(
        tenant=entry.tenant,
        user=user,
        action="journal_reversed",
        resource_type="JournalEntry",
        resource_id=entry.id,
        reason=reason,
        after={"reversal_id": reversal.id},
    )
    return reversal


@transaction.atomic
def close_period(period: AccountingPeriod, *, user: User) -> AccountingPeriod:
    period = AccountingPeriod.objects.select_for_update().get(pk=period.pk)
    if period.status not in {
        AccountingPeriod.Status.OPEN,
        AccountingPeriod.Status.REOPENED,
    }:
        raise ValueError("Periode tidak dalam status yang dapat ditutup.")
    if JournalEntry.objects.filter(
        period=period, status=JournalEntry.Status.DRAFT
    ).exists():
        raise ValueError("Masih ada jurnal draft pada periode ini.")
    if ReconciliationIssue.objects.filter(
        tenant=period.tenant,
        status=ReconciliationIssue.Status.OPEN,
    ).exists():
        raise ValueError("Masih ada transaksi yang gagal direkonsiliasi.")
    period.status = AccountingPeriod.Status.CLOSED
    period.closed_by = user
    period.closed_at = timezone.now()
    period.save(update_fields=["status", "closed_by", "closed_at", "updated_at"])
    record_audit(
        tenant=period.tenant,
        user=user,
        action="accounting_period_closed",
        resource_type="AccountingPeriod",
        resource_id=period.id,
        after={"status": period.status},
    )
    return period


@transaction.atomic
def reopen_period(
    period: AccountingPeriod, *, user: User, reason: str
) -> AccountingPeriod:
    period = AccountingPeriod.objects.select_for_update().get(pk=period.pk)
    if not Membership.objects.filter(
        tenant=period.tenant,
        user=user,
        role=Membership.Role.SUPER_ADMIN,
        is_active=True,
    ).exists():
        raise PermissionError("Pembukaan periode wajib dilakukan Super Admin.")
    if period.status != AccountingPeriod.Status.CLOSED:
        raise ValueError("Hanya periode tertutup yang dapat dibuka kembali.")
    if not reason:
        raise ValueError("Pembukaan periode wajib memiliki alasan.")
    period.status = AccountingPeriod.Status.REOPENED
    period.reopened_by = user
    period.reopened_at = timezone.now()
    period.reopen_reason = reason
    period.save(
        update_fields=[
            "status",
            "reopened_by",
            "reopened_at",
            "reopen_reason",
            "updated_at",
        ]
    )
    record_audit(
        tenant=period.tenant,
        user=user,
        action="accounting_period_reopened",
        resource_type="AccountingPeriod",
        resource_id=period.id,
        reason=reason,
        after={"status": period.status},
    )
    return period


def trial_balance(tenant: Tenant, *, end_date: date | None = None) -> list[dict]:
    lines = JournalLine.objects.filter(
        tenant=tenant, journal__status=JournalEntry.Status.POSTED
    )
    if end_date:
        lines = lines.filter(journal__date__lte=end_date)
    rows = (
        lines.values(
            "account_id", "account__code", "account__name", "account__account_type"
        )
        .annotate(debit=Sum("debit"), credit=Sum("credit"))
        .order_by("account__code")
    )
    return [
        {
            **row,
            "balance": (row["debit"] or Decimal("0")) - (row["credit"] or Decimal("0")),
        }
        for row in rows
    ]
