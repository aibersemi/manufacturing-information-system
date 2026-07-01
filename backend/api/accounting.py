from datetime import date
from decimal import Decimal
from typing import List, Optional

from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.accounting.models import AccountingPeriod, JournalEntry
from backend.accounting.services import (
    close_period,
    create_journal,
    reopen_period,
    reverse_journal,
    trial_balance,
)
from backend.core.access import require_capability, tenant_session_auth

router = Router(tags=["Accounting"], auth=tenant_session_auth)


class JournalLinePayload(Schema):
    account_id: str
    description: Optional[str] = None
    debit: Decimal = Decimal(0)
    credit: Decimal = Decimal(0)


class JournalEntryPayload(Schema):
    period_id: str
    date: date
    description: str
    reference: Optional[str] = None
    lines: List[JournalLinePayload]


class JournalEntryResponse(Schema):
    id: str
    period_id: str
    date: date
    description: str
    reference: Optional[str]
    status: str


@router.post("/journals", response=JournalEntryResponse)
def create_journal_entry(request: HttpRequest, payload: JournalEntryPayload):
    context = require_capability(request, "accounting.journals.create")
    period = AccountingPeriod.objects.filter(
        tenant=context.tenant, id=payload.period_id
    ).first()
    if not period:
        raise HttpError(404, "Periode akuntansi tidak ditemukan")
    if not period.start_date <= payload.date <= period.end_date:
        raise HttpError(422, "Tanggal jurnal berada di luar periode yang dipilih")
    try:
        journal = create_journal(
            tenant=period.tenant,
            journal_date=payload.date,
            description=payload.description,
            reference=payload.reference or "",
            user=request.user,
            final=True,
            lines=[line.dict() for line in payload.lines],
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {
        "id": str(journal.id),
        "period_id": str(journal.period.id),
        "date": journal.date,
        "description": journal.description,
        "reference": journal.reference,
        "status": journal.status,
    }


@router.get("/journals", response=List[JournalEntryResponse])
def list_journals(request: HttpRequest):
    context = require_capability(request, "accounting.journals.read")
    journals = JournalEntry.objects.filter(tenant=context.tenant).order_by(
        "-date", "-created_at"
    )
    return [
        {
            "id": str(j.id),
            "period_id": str(j.period.id),
            "date": j.date,
            "description": j.description,
            "reference": j.reference,
            "status": j.status,
        }
        for j in journals
    ]


# Financial Report Summary Endpoint
class FinancialSummaryResponse(Schema):
    total_assets: str
    total_liabilities: str
    total_equity: str
    net_income: str


@router.get("/reports/summary", response=FinancialSummaryResponse)
def get_financial_summary(request: HttpRequest):
    context = require_capability(request, "accounting.reports.read")
    tenant = context.tenant
    rows = trial_balance(tenant)
    totals = {
        "asset": Decimal("0"),
        "liability": Decimal("0"),
        "equity": Decimal("0"),
        "revenue": Decimal("0"),
        "expense": Decimal("0"),
    }
    for row in rows:
        totals[row["account__account_type"]] += row["balance"]
    return {
        "total_assets": str(totals["asset"]),
        "total_liabilities": str(-totals["liability"]),
        "total_equity": str(-totals["equity"]),
        "net_income": str(-totals["revenue"] - totals["expense"]),
    }


class PeriodActionPayload(Schema):
    reason: str = ""


class PeriodResponse(Schema):
    id: str
    name: str
    start_date: date
    end_date: date
    status: str


@router.get("/periods", response=List[PeriodResponse])
def list_accounting_periods(request: HttpRequest):
    context = require_capability(request, "accounting.periods.read")
    return AccountingPeriod.objects.filter(tenant=context.tenant).order_by(
        "-start_date"
    )


@router.post("/journals/{journal_id}/reverse", response=JournalEntryResponse)
def reverse_journal_entry(
    request: HttpRequest, journal_id: str, payload: PeriodActionPayload
):
    context = require_capability(request, "accounting.journals.reverse")
    journal = JournalEntry.objects.filter(tenant=context.tenant, id=journal_id).first()
    if journal is None:
        raise HttpError(404, "Jurnal tidak ditemukan")
    try:
        return reverse_journal(journal, user=request.user, reason=payload.reason)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/periods/{period_id}/close", response=PeriodResponse)
def close_accounting_period(request: HttpRequest, period_id: str):
    context = require_capability(request, "accounting.periods.close")
    period = AccountingPeriod.objects.filter(
        tenant=context.tenant, id=period_id
    ).first()
    if period is None:
        raise HttpError(404, "Periode tidak ditemukan")
    try:
        return close_period(period, user=request.user)
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.post("/periods/{period_id}/reopen", response=PeriodResponse)
def reopen_accounting_period(
    request: HttpRequest, period_id: str, payload: PeriodActionPayload
):
    context = require_capability(request, "accounting.periods.reopen")
    period = AccountingPeriod.objects.filter(
        tenant=context.tenant, id=period_id
    ).first()
    if period is None:
        raise HttpError(404, "Periode tidak ditemukan")
    try:
        return reopen_period(period, user=request.user, reason=payload.reason)
    except PermissionError as exc:
        raise HttpError(403, str(exc)) from exc
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc


@router.get("/reports/trial-balance")
def get_trial_balance(request: HttpRequest, end_date: Optional[date] = None):
    context = require_capability(request, "accounting.reports.read")
    tenant = context.tenant
    return trial_balance(tenant, end_date=end_date)
