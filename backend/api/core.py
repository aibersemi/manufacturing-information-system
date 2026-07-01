from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import (
    ROLE_FINANCE,
    ROLE_KEPALA,
    ROLE_OPERATOR,
    ROLE_SUPER_ADMIN,
    require_any_capability,
    require_capability,
    tenant_session_auth,
)
from backend.core.models import ApprovalRequest, AuditEvent, Notification
from backend.core.services import review_approval

router = Router(tags=["Core"], auth=tenant_session_auth)


class ApprovalReviewPayload(Schema):
    approve: bool
    reason: str


class ApprovalResponse(Schema):
    id: UUID
    action_type: str
    resource_type: str
    resource_id: str
    reason: str
    status: str
    requested_by_id: int
    reviewed_by_id: Optional[int] = None
    created_at: datetime
    reviewed_at: Optional[datetime] = None


class AuditResponse(Schema):
    id: int
    user_id: Optional[int] = None
    tenant_id: Optional[int] = None
    action: str
    resource_type: str
    resource_id: str
    detail: dict[str, Any]
    request_id: str
    created_at: datetime


class NotificationResponse(Schema):
    id: UUID
    event_type: str
    title: str
    message: str
    safe_path: str
    status: str
    created_at: datetime


@router.get("/approvals", response=list[ApprovalResponse])
def list_approvals(request: HttpRequest, status: Optional[str] = None):
    context = require_capability(request, "core.approvals.read")
    queryset = ApprovalRequest.objects.filter(tenant=context.tenant)
    if status:
        queryset = queryset.filter(status=status)
    return list(
        queryset.order_by("-created_at").values(
            "id",
            "action_type",
            "resource_type",
            "resource_id",
            "reason",
            "status",
            "requested_by_id",
            "reviewed_by_id",
            "created_at",
            "reviewed_at",
        )
    )


@router.post("/approvals/{approval_id}/review")
def review(request: HttpRequest, approval_id: UUID, payload: ApprovalReviewPayload):
    context = require_capability(request, "core.approvals.review")
    approval = ApprovalRequest.objects.filter(
        tenant=context.tenant, id=approval_id
    ).first()
    if approval is None:
        raise HttpError(404, "Approval tidak ditemukan")
    try:
        reviewed = review_approval(
            approval,
            reviewer=request.user,
            approve=payload.approve,
            reason=payload.reason,
        )
    except (PermissionError, ValueError) as exc:
        raise HttpError(422, str(exc)) from exc
    return {"id": str(reviewed.id), "status": reviewed.status}


@router.get("/audit", response=list[AuditResponse])
def list_audit_events(
    request: HttpRequest,
    action: Optional[str] = None,
    since: Optional[datetime] = None,
    limit: int = 100,
):
    context = require_any_capability(request, {"core.audit.read", "core.audit.self"})
    queryset = AuditEvent.objects.filter(tenant=context.tenant)
    if context.role == ROLE_OPERATOR:
        queryset = queryset.filter(user=request.user)
    elif context.role == ROLE_FINANCE:
        queryset = queryset.filter(
            resource_type__in={
                "PaymentRequest",
                "CustomerInvoice",
                "CustomerPayment",
                "JournalEntry",
                "PieceRatePayment",
                "Asset",
                "endpoint",
            }
        )
    elif context.role not in {ROLE_SUPER_ADMIN, ROLE_KEPALA}:
        raise HttpError(403, "Tidak memiliki akses audit")
    if action:
        queryset = queryset.filter(action=action)
    if since:
        queryset = queryset.filter(created_at__gte=since)
    return list(
        queryset.order_by("-created_at")[: min(max(limit, 1), 500)].values(
            "id",
            "user_id",
            "tenant_id",
            "action",
            "resource_type",
            "resource_id",
            "detail",
            "request_id",
            "created_at",
        )
    )


@router.get("/notifications", response=list[NotificationResponse])
def list_notifications(request: HttpRequest, unread_only: bool = False):
    context = require_capability(request, "core.notifications.read")
    queryset = Notification.objects.filter(
        tenant=context.tenant,
        recipient=request.user,
        channel=Notification.Channel.IN_APP,
    )
    if unread_only:
        queryset = queryset.exclude(status=Notification.Status.READ)
    return list(
        queryset.order_by("-created_at")[:100].values(
            "id",
            "event_type",
            "title",
            "message",
            "safe_path",
            "status",
            "created_at",
        )
    )


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(request: HttpRequest, notification_id: UUID):
    context = require_capability(request, "core.notifications.read")
    updated = Notification.objects.filter(
        tenant=context.tenant, recipient=request.user, id=notification_id
    ).update(status=Notification.Status.READ)
    if not updated:
        raise HttpError(404, "Notifikasi tidak ditemukan")
    return {"detail": "ok"}
