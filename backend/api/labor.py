from datetime import date
from decimal import Decimal
from typing import List, Optional

from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import (
    ROLE_OPERATOR,
    require_any_capability,
    require_capability,
    tenant_session_auth,
)
from backend.core.capabilities import require_operator_context
from backend.labor.models import Attendance, CashAdvance, PieceRatePayment
from backend.labor.services import pay_piece_rate, record_own_attendance
from backend.masterdata.models import BankAccount, Operator
from backend.production.models import OperatorWorkLog

router = Router(tags=["Labor"], auth=tenant_session_auth)


# --- Schemas ---
class AttendancePayload(Schema):
    operator_id: str
    date: date
    is_present: bool = True
    notes: Optional[str] = None


class AttendanceResponse(Schema):
    id: str
    operator_id: str
    operator_name: str
    date: date
    is_present: bool
    notes: Optional[str]


class CashAdvancePayload(Schema):
    operator_id: str
    date: date
    amount: Decimal
    notes: Optional[str] = None


class CashAdvanceResponse(Schema):
    id: str
    operator_id: str
    operator_name: str
    date: date
    amount: str
    remaining_amount: str
    is_paid: bool
    notes: Optional[str]


class OperatorWorkLogResponse(Schema):
    id: str
    progress_id: str
    job_packet_id: str
    qty_claimed: int
    piece_rate_applied: str
    amount_total: str
    is_verified: bool
    is_paid: bool


class PieceRatePaymentResponse(Schema):
    id: str
    date: date
    gross_amount: str
    cash_advance_deduction: str
    net_paid: str
    payment_reference: str


# --- Endpoints ---
@router.get("/attendance", response=List[AttendanceResponse])
def list_attendance(request: HttpRequest, attendance_date: Optional[date] = None):
    context = require_any_capability(
        request, {"labor.attendance.read", "labor.attendance.self"}
    )
    tenant_id = context.tenant_id
    queryset = Attendance.objects.filter(tenant_id=tenant_id).select_related("operator")
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        if operator_context.status == Operator.OperatorStatus.EXTERNAL:
            raise HttpError(403, "Operator eksternal tidak menggunakan absensi harian")
        queryset = queryset.filter(operator=operator_context.operator)
    if attendance_date:
        queryset = queryset.filter(date=attendance_date)
    return [
        {
            "id": str(item.id),
            "operator_id": str(item.operator_id),
            "operator_name": item.operator.name,
            "date": item.date,
            "is_present": item.is_present,
            "notes": item.notes,
        }
        for item in queryset.order_by("-date", "operator__name")[:500]
    ]


@router.post("/attendance", response=AttendanceResponse)
def record_attendance(request: HttpRequest, payload: AttendancePayload):
    context = require_any_capability(
        request, {"labor.attendance.create", "labor.attendance.self"}
    )
    tenant_id = context.tenant_id
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        if operator_context.status == Operator.OperatorStatus.EXTERNAL:
            raise HttpError(403, "Operator eksternal tidak menggunakan absensi harian")
        try:
            attendance = record_own_attendance(
                tenant=request.tenant_context.tenant,
                user=request.user,
                attendance_date=payload.date,
                is_present=payload.is_present,
                notes=payload.notes or "",
            )
        except PermissionError as exc:
            raise HttpError(403, str(exc)) from exc
        return {
            "id": str(attendance.id),
            "operator_id": str(attendance.operator.id),
            "operator_name": attendance.operator.name,
            "date": attendance.date,
            "is_present": attendance.is_present,
            "notes": attendance.notes,
        }
    operator = Operator.objects.filter(
        tenant_id=tenant_id, id=payload.operator_id
    ).first()
    if not operator:
        raise HttpError(404, "Operator tidak ditemukan")

    attendance, _created = Attendance.objects.update_or_create(
        tenant_id=tenant_id,
        operator=operator,
        date=payload.date,
        defaults={"is_present": payload.is_present, "notes": payload.notes},
    )
    return {
        "id": str(attendance.id),
        "operator_id": str(attendance.operator.id),
        "operator_name": attendance.operator.name,
        "date": attendance.date,
        "is_present": attendance.is_present,
        "notes": attendance.notes,
    }


@router.post("/cash-advance", response=CashAdvanceResponse)
def request_cash_advance(request: HttpRequest, payload: CashAdvancePayload):
    context = require_any_capability(
        request, {"labor.cash_advances.create", "labor.cash_advance.self"}
    )
    tenant_id = context.tenant_id
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        if operator_context.status == Operator.OperatorStatus.EXTERNAL:
            raise HttpError(403, "Operator eksternal tidak dapat mengajukan kasbon")
        operator = operator_context.operator
    else:
        operator = Operator.objects.filter(
            tenant_id=tenant_id, id=payload.operator_id
        ).first()
        if not operator:
            raise HttpError(404, "Operator tidak ditemukan")
        if operator.status == Operator.OperatorStatus.EXTERNAL:
            raise HttpError(403, "Operator eksternal tidak dapat mengajukan kasbon")

    ca = CashAdvance.objects.create(
        tenant_id=tenant_id,
        operator=operator,
        date=payload.date,
        amount=payload.amount,
        remaining_amount=payload.amount,
        is_paid=False,
        notes=payload.notes,
        created_by=request.user,
    )
    return {
        "id": str(ca.id),
        "operator_id": str(ca.operator.id),
        "operator_name": ca.operator.name,
        "date": ca.date,
        "amount": str(ca.amount),
        "remaining_amount": str(ca.remaining_amount),
        "is_paid": ca.is_paid,
        "notes": ca.notes,
    }


@router.get("/cash-advances", response=List[CashAdvanceResponse])
def list_cash_advances(request: HttpRequest):
    context = require_any_capability(
        request, {"labor.cash_advances.read", "labor.cash_advance.self"}
    )
    tenant_id = context.tenant_id
    cas = CashAdvance.objects.filter(tenant_id=tenant_id).select_related("operator")
    if request.tenant_context.role == ROLE_OPERATOR:
        operator_context = require_operator_context(request)
        if operator_context.status == Operator.OperatorStatus.EXTERNAL:
            raise HttpError(403, "Operator eksternal tidak menggunakan kasbon")
        cas = cas.filter(operator=operator_context.operator)
    return [
        {
            "id": str(ca.id),
            "operator_id": str(ca.operator.id),
            "operator_name": ca.operator.name,
            "date": ca.date,
            "amount": str(ca.amount),
            "remaining_amount": str(ca.remaining_amount),
            "is_paid": ca.is_paid,
            "notes": ca.notes,
        }
        for ca in cas
    ]


@router.get("/work-logs", response=List[OperatorWorkLogResponse])
def list_own_work_logs(request: HttpRequest):
    context = require_capability(request, "labor.work_logs.self")
    tenant_id = context.tenant_id
    operator_context = require_operator_context(request)
    logs = (
        OperatorWorkLog.objects.select_related("progress__job_packet")
        .filter(tenant_id=tenant_id, operator=operator_context.operator)
        .order_by("-created_at")[:200]
    )
    return [
        {
            "id": str(item.id),
            "progress_id": str(item.progress_id),
            "job_packet_id": str(item.progress.job_packet_id),
            "qty_claimed": item.qty_claimed,
            "piece_rate_applied": str(item.piece_rate_applied),
            "amount_total": str(item.amount_total),
            "is_verified": item.is_verified,
            "is_paid": item.is_paid,
        }
        for item in logs
    ]


@router.get("/piece-rate-payments", response=List[PieceRatePaymentResponse])
def list_own_piece_rate_payments(request: HttpRequest):
    context = require_capability(request, "labor.work_logs.self")
    tenant_id = context.tenant_id
    operator_context = require_operator_context(request)
    payments = PieceRatePayment.objects.filter(
        tenant_id=tenant_id, operator=operator_context.operator
    ).order_by("-date", "-created_at")[:200]
    return [
        {
            "id": str(payment.id),
            "date": payment.date,
            "gross_amount": str(payment.gross_amount),
            "cash_advance_deduction": str(payment.cash_advance_deduction),
            "net_paid": str(payment.net_paid),
            "payment_reference": payment.payment_reference,
        }
        for payment in payments
    ]


class PieceRatePaymentPayload(Schema):
    operator_id: str
    work_log_ids: List[str]
    paid_rates: dict[str, Decimal] = {}
    adjustment_reasons: dict[str, str] = {}
    account_id: str
    proof_id: str


@router.post("/piece-rate-payments")
def create_piece_rate_payment(request: HttpRequest, payload: PieceRatePaymentPayload):
    context = require_capability(request, "labor.piece_rate.pay")
    tenant_id = context.tenant_id
    operator = Operator.objects.filter(
        tenant_id=tenant_id, id=payload.operator_id
    ).first()
    account = BankAccount.objects.filter(
        tenant_id=tenant_id, id=payload.account_id, is_active=True
    ).first()
    if operator is None or account is None:
        raise HttpError(404, "Operator atau rekening tidak ditemukan")
    try:
        payment = pay_piece_rate(
            tenant=request.tenant_context.tenant,
            operator=operator,
            work_log_ids=payload.work_log_ids,
            paid_rates=payload.paid_rates,
            adjustment_reasons=payload.adjustment_reasons,
            account=account,
            user=request.user,
            proof_id=payload.proof_id,
        )
    except ValueError as exc:
        raise HttpError(422, str(exc)) from exc
    return {
        "id": str(payment.id),
        "gross_amount": str(payment.gross_amount),
        "cash_advance_deduction": str(payment.cash_advance_deduction),
        "net_paid": str(payment.net_paid),
    }
