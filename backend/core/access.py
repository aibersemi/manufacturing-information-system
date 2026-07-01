"""Kontrol akses tenant dan role untuk seluruh endpoint bisnis MIS."""

from dataclasses import dataclass
from collections.abc import Iterable
from typing import Any

from django.http import HttpRequest
from ninja.errors import HttpError
from ninja.security.session import SessionAuth

from backend.core.models import AuditEvent, Membership, Tenant


def get_effective_membership(user: Any, tenant: Tenant) -> Membership | None:
    """
    Ambil membership aktif, dengan bypass terkendali untuk superuser server-side.

    Akun `is_superuser` adalah akun operasional yang dibuat dari konfigurasi
    server. Ia berperan sebagai `super_admin` pada setiap tenant aktif tanpa
    perlu baris membership eksplisit per tenant.
    """

    membership = (
        Membership.objects.select_related("tenant")
        .filter(user=user, tenant=tenant, is_active=True)
        .first()
    )
    if getattr(user, "is_superuser", False):
        if membership is not None and membership.role == Membership.Role.SUPER_ADMIN:
            return membership
        return Membership(
            user=user,
            tenant=tenant,
            role=Membership.Role.SUPER_ADMIN,
            is_active=True,
        )
    return membership


@dataclass(frozen=True)
class TenantContext:
    """Identitas otorisasi yang sudah diverifikasi untuk satu request."""

    tenant: Tenant
    membership: Membership

    @property
    def tenant_id(self) -> int:
        return self.tenant.pk

    @property
    def role(self) -> str:
        return self.membership.role


def _record_denied(request: HttpRequest, reason: str, tenant_id: int | None) -> None:
    """Catat penolakan tanpa membocorkan detail objek ke client."""

    AuditEvent.objects.create(
        tenant_id=tenant_id,
        user=request.user
        if getattr(request, "user", None) and request.user.is_authenticated
        else None,
        action="access_denied",
        resource_type="api_request",
        resource_id=request.path[:200],
        detail={"reason": reason, "method": request.method},
        ip_address=request.META.get("REMOTE_ADDR"),
        request_id=getattr(request, "request_id", ""),
    )


def get_tenant_context(
    request: HttpRequest,
    *,
    allowed_roles: set[str] | frozenset[str] | None = None,
) -> TenantContext:
    """Validasi ulang user, tenant aktif, membership, dan role pada setiap request."""

    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated or not user.is_active:
        raise HttpError(401, "Sesi tidak valid atau telah berakhir")

    tenant_id = request.session.get("active_tenant_id")
    if not tenant_id:
        raise HttpError(401, "Session konveksi tidak aktif")

    tenant = Tenant.objects.filter(id=tenant_id, is_active=True).first()
    membership = get_effective_membership(user, tenant) if tenant is not None else None
    if membership is None:
        request.session.flush()
        _record_denied(request, "membership_tidak_valid", tenant_id)
        raise HttpError(401, "Sesi tidak valid atau telah berakhir")

    if allowed_roles is not None and membership.role not in allowed_roles:
        _record_denied(request, "role_tidak_diizinkan", tenant_id)
        raise HttpError(403, "Anda tidak memiliki izin untuk aksi ini")

    context = TenantContext(tenant=tenant, membership=membership)
    request.tenant_context = context
    return context


def _effective_capabilities(request: HttpRequest, context: TenantContext) -> set[str]:
    from backend.core.capabilities import (  # noqa: PLC0415
        capabilities_for,
        resolve_operator_context,
    )

    operator_context = (
        resolve_operator_context(context.tenant, request.user)
        if context.role == Membership.Role.OPERATOR
        else None
    )
    return set(capabilities_for(context.role, operator_context))


def require_capability(request: HttpRequest, capability: str) -> TenantContext:
    """Validasi konteks tenant dan satu capability aksi."""

    context = get_tenant_context(request)
    if capability not in _effective_capabilities(request, context):
        _record_denied(
            request, f"capability_tidak_diizinkan:{capability}", context.tenant_id
        )
        raise HttpError(403, "Anda tidak memiliki izin untuk aksi ini")
    return context


def require_any_capability(
    request: HttpRequest, capabilities: Iterable[str]
) -> TenantContext:
    """Validasi konteks tenant dan minimal satu capability aksi."""

    requested = set(capabilities)
    context = get_tenant_context(request)
    if _effective_capabilities(request, context).isdisjoint(requested):
        _record_denied(
            request,
            "capability_tidak_diizinkan:" + ",".join(sorted(requested)),
            context.tenant_id,
        )
        raise HttpError(403, "Anda tidak memiliki izin untuk aksi ini")
    return context


def get_tenant_id(
    request: HttpRequest,
    *,
    allowed_roles: set[str] | frozenset[str] | None = None,
) -> int:
    """Shortcut kompatibel untuk endpoint lama yang tetap memvalidasi membership."""

    return get_tenant_context(request, allowed_roles=allowed_roles).tenant_id


class TenantSessionAuth(SessionAuth):
    """Session auth yang juga memastikan konteks tenant masih sah."""

    def authenticate(self, request: HttpRequest, key: str | None) -> Any | None:
        user = super().authenticate(request, key)
        if user is None:
            return None
        try:
            get_tenant_context(request)
        except HttpError:
            return None
        return user


tenant_session_auth = TenantSessionAuth()


ROLE_SUPER_ADMIN = Membership.Role.SUPER_ADMIN
ROLE_KEPALA = Membership.Role.KEPALA_KONVEKSI
ROLE_FINANCE = Membership.Role.FINANCE
ROLE_OPERATOR = Membership.Role.OPERATOR

ROLES_MANAGEMENT = frozenset({ROLE_SUPER_ADMIN, ROLE_KEPALA})
ROLES_OPERATIONAL = frozenset({ROLE_SUPER_ADMIN, ROLE_KEPALA, ROLE_OPERATOR})
ROLES_FINANCE = frozenset({ROLE_SUPER_ADMIN, ROLE_FINANCE})
ROLES_ALL = frozenset({ROLE_SUPER_ADMIN, ROLE_KEPALA, ROLE_FINANCE, ROLE_OPERATOR})
