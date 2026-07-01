"""Service fondasi: penomoran, audit, approval, dan bootstrap tenant."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.forms.models import model_to_dict
from django.utils import timezone

from backend.core.models import (
    ApprovalRequest,
    AuditEvent,
    BusinessPolicy,
    DocumentSequence,
    Membership,
    Tenant,
    User,
)


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if is_dataclass(value):
        return {key: _json_value(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_value(item) for item in value]
    if hasattr(value, "pk"):
        return str(value.pk)
    return str(value)


def model_snapshot(instance) -> dict[str, Any]:
    """Snapshot JSON-safe untuk before/after audit."""

    return {key: _json_value(value) for key, value in model_to_dict(instance).items()}


def record_audit(
    *,
    tenant: Tenant | None,
    user: User | None,
    action: str,
    resource_type: str,
    resource_id: str = "",
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str = "",
    request_id: str = "",
    ip_address: str | None = None,
    result: str = "success",
    extra: dict[str, Any] | None = None,
) -> AuditEvent:
    detail = {
        "before": _json_value(before or {}),
        "after": _json_value(after or {}),
        "reason": reason,
        "result": result,
    }
    if extra:
        detail.update(_json_value(extra))
    return AuditEvent.objects.create(
        tenant=tenant,
        user=user,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        detail=detail,
        request_id=request_id,
        ip_address=ip_address,
    )


@transaction.atomic
def next_document_number(
    tenant: Tenant, document_type: str, *, at: date | datetime | None = None
) -> str:
    """Ambil nomor dokumen atomik dan tidak pernah memakai ulang nomor lama."""

    current = at or timezone.localdate()
    period = current.strftime("%Y%m")
    sequence, _created = DocumentSequence.objects.select_for_update().get_or_create(
        tenant=tenant,
        document_type=document_type.upper(),
        period=period,
        defaults={"current_number": 0},
    )
    sequence.current_number += 1
    sequence.save(update_fields=["current_number", "updated_at"])
    tenant_code = (tenant.code or tenant.slug).upper()[:12]
    return (
        f"{tenant_code}/{document_type.upper()}/{period}/{sequence.current_number:04d}"
    )


def ensure_business_policy(tenant: Tenant) -> BusinessPolicy:
    policy, _created = BusinessPolicy.objects.get_or_create(tenant=tenant)
    return policy


@transaction.atomic
def request_approval(
    *,
    tenant: Tenant,
    user: User,
    action_type: str,
    resource_type: str,
    resource_id: str,
    reason: str,
    payload: dict[str, Any] | None = None,
) -> ApprovalRequest:
    approval = ApprovalRequest.objects.create(
        tenant=tenant,
        action_type=action_type,
        resource_type=resource_type,
        resource_id=str(resource_id),
        reason=reason,
        payload=_json_value(payload or {}),
        requested_by=user,
    )
    record_audit(
        tenant=tenant,
        user=user,
        action="approval_requested",
        resource_type=resource_type,
        resource_id=resource_id,
        reason=reason,
        after={"approval_id": approval.id, "action_type": action_type},
    )
    return approval


@transaction.atomic
def review_approval(
    approval: ApprovalRequest,
    *,
    reviewer: User,
    approve: bool,
    reason: str,
) -> ApprovalRequest:
    membership = Membership.objects.filter(
        tenant=approval.tenant,
        user=reviewer,
        is_active=True,
        role=Membership.Role.SUPER_ADMIN,
    ).first()
    if membership is None:
        raise PermissionError("Approval ini wajib direview Super Admin.")
    if approval.status != ApprovalRequest.Status.PENDING:
        raise ValueError("Approval sudah diproses.")
    approval.status = (
        ApprovalRequest.Status.APPROVED if approve else ApprovalRequest.Status.REJECTED
    )
    approval.reviewed_by = reviewer
    approval.review_reason = reason
    approval.reviewed_at = timezone.now()
    approval.save(
        update_fields=["status", "reviewed_by", "review_reason", "reviewed_at"]
    )
    record_audit(
        tenant=approval.tenant,
        user=reviewer,
        action="approval_reviewed",
        resource_type=approval.resource_type,
        resource_id=approval.resource_id,
        reason=reason,
        after={"approval_id": approval.id, "status": approval.status},
    )
    return approval
