"""
Router autentikasi session untuk MIS.

Endpoint auth sengaja tetap memakai session cookie Django, bukan token di
browser storage. Login publik memakai auth cookie khusus agar Django Ninja
tetap menjalankan validasi CSRF walaupun user belum punya session login.
"""

import logging
from typing import Any

from django.conf import settings
from django.contrib.auth import (
    authenticate,
    login,
    logout,
    update_session_auth_hash,
)
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.http import HttpRequest
from django.middleware.csrf import get_token
from ninja import Router, Schema, Status
from ninja.security import APIKeyCookie, django_auth
from pydantic import Field

from backend.core.access import get_effective_membership
from backend.core.capabilities import capabilities_for, resolve_operator_context
from backend.core.models import AuditEvent, Membership, Tenant

logger = logging.getLogger(__name__)
router = Router(tags=["Auth"])

GENERIC_LOGIN_ERROR = "Kombinasi konveksi, nama pengguna, atau kata sandi tidak valid."
LOGIN_RATE_LIMIT_MAX = 5
LOGIN_RATE_LIMIT_WINDOW = 300
PASSWORD_VERIFICATION_RATE_LIMIT_MAX = 5
PASSWORD_VERIFICATION_RATE_LIMIT_WINDOW = 300


class CsrfOnlyAuth(APIKeyCookie):
    """Auth handler yang hanya memaksa CSRF untuk mutation publik."""

    param_name = settings.CSRF_COOKIE_NAME

    def authenticate(self, request: HttpRequest, key: str | None) -> bool:
        return True


csrf_only = CsrfOnlyAuth()


class LoginRequest(Schema):
    tenant_slug: str = Field(min_length=1, max_length=63)
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=256)


class SwitchTenantRequest(Schema):
    tenant_slug: str = Field(min_length=1, max_length=63)


class ChangePasswordRequest(Schema):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)
    new_password_confirmation: str = Field(min_length=8, max_length=256)


class TenantResponse(Schema):
    slug: str
    name: str


class TenantInfo(Schema):
    id: int
    slug: str
    name: str


class UserInfo(Schema):
    id: int
    username: str
    full_name: str


class UserResponse(Schema):
    user: UserInfo
    tenant: TenantInfo
    role: str
    # Field kompatibilitas untuk client/test lama. Kontrak utama tetap
    # `user`, `tenant`, dan `role`.
    id: int
    username: str
    full_name: str
    active_tenant_id: int


class OperatorCapabilityInfo(Schema):
    id: str
    name: str
    operator_type: str
    status: str
    is_active: bool
    supervisor_id: str | None = None


class CapabilityResponse(Schema):
    user: UserInfo
    tenant: TenantInfo
    role: str
    operator: OperatorCapabilityInfo | None
    capabilities: list[str]


class ErrorResponse(Schema):
    detail: str


def _get_client_ip(request: HttpRequest) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",", maxsplit=1)[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")


def _rate_limit_key(ip_address: str, username: str) -> str:
    return f"auth:login_attempts:{ip_address}:{username}"


def _is_rate_limited(ip_address: str, username: str) -> bool:
    return (
        int(cache.get(_rate_limit_key(ip_address, username), 0)) >= LOGIN_RATE_LIMIT_MAX
    )


def _record_failed_attempt(ip_address: str, username: str) -> None:
    key = _rate_limit_key(ip_address, username)
    if cache.add(key, 1, LOGIN_RATE_LIMIT_WINDOW):
        return
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, LOGIN_RATE_LIMIT_WINDOW)


def _clear_failed_attempts(ip_address: str, username: str) -> None:
    cache.delete(_rate_limit_key(ip_address, username))


def _password_verification_key(request: HttpRequest) -> str:
    return f"auth:password_verification:{request.user.pk}:{_get_client_ip(request)}"


def password_verification_is_limited(request: HttpRequest) -> bool:
    return (
        int(cache.get(_password_verification_key(request), 0))
        >= PASSWORD_VERIFICATION_RATE_LIMIT_MAX
    )


def record_password_verification_failure(request: HttpRequest) -> None:
    key = _password_verification_key(request)
    if cache.add(key, 1, PASSWORD_VERIFICATION_RATE_LIMIT_WINDOW):
        return
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, PASSWORD_VERIFICATION_RATE_LIMIT_WINDOW)


def clear_password_verification_failures(request: HttpRequest) -> None:
    cache.delete(_password_verification_key(request))


def _audit_session_event(
    *,
    action: str,
    request: HttpRequest,
    user=None,
    tenant=None,
    detail: dict[str, Any] | None = None,
) -> None:
    AuditEvent.objects.create(
        tenant=tenant,
        user=user,
        action=action,
        resource_type="session",
        resource_id=request.session.session_key or "",
        detail=detail or {},
        ip_address=_get_client_ip(request),
        request_id=getattr(request, "request_id", ""),
    )


def _session_response(user, tenant: Tenant, role: str) -> dict[str, Any]:
    full_name = user.get_full_name() or user.username
    return {
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": full_name,
        },
        "tenant": {
            "id": tenant.id,
            "slug": tenant.slug,
            "name": tenant.name,
        },
        "role": role,
        "id": user.id,
        "username": user.username,
        "full_name": full_name,
        "active_tenant_id": tenant.id,
    }


@router.get(
    "/tenants",
    response=list[TenantResponse],
    auth=None,
    summary="Daftar tenant aktif",
)
def get_tenants(request: HttpRequest):
    """
    Mengambil daftar tenant aktif untuk form login.

    Endpoint ini juga menerbitkan cookie CSRF awal agar mutation login lintas
    subdomain bisa mengirim `X-CSRFToken` tanpa menyimpan kredensial di storage.
    """
    get_token(request)
    return list(Tenant.objects.filter(is_active=True).values("slug", "name"))


@router.post(
    "/login",
    response={
        200: UserResponse,
        401: ErrorResponse,
        429: ErrorResponse,
    },
    auth=csrf_only,
    summary="Login",
)
def api_login(request: HttpRequest, payload: LoginRequest):
    ip_address = _get_client_ip(request)
    username = payload.username.strip()
    tenant_slug = payload.tenant_slug.strip()

    if _is_rate_limited(ip_address, username):
        _audit_session_event(
            action="login_rate_limited",
            request=request,
            detail={"username": username, "tenant_slug": tenant_slug},
        )
        return Status(
            429,
            {"detail": "Terlalu banyak percobaan login. Coba lagi nanti."},
        )

    user = authenticate(request, username=username, password=payload.password)
    if user is None or not user.is_active:
        _record_failed_attempt(ip_address, username)
        _audit_session_event(
            action="login_failed",
            request=request,
            detail={"username": username, "tenant_slug": tenant_slug},
        )
        return Status(401, {"detail": GENERIC_LOGIN_ERROR})

    tenant = Tenant.objects.filter(slug=tenant_slug, is_active=True).first()
    if tenant is None:
        _record_failed_attempt(ip_address, username)
        _audit_session_event(
            action="login_failed",
            request=request,
            user=user,
            detail={"reason": "tenant_not_found", "tenant_slug": tenant_slug},
        )
        return Status(401, {"detail": GENERIC_LOGIN_ERROR})

    membership = get_effective_membership(user, tenant)
    if membership is None:
        _record_failed_attempt(ip_address, username)
        _audit_session_event(
            action="login_failed",
            request=request,
            user=user,
            tenant=tenant,
            detail={"reason": "no_active_membership"},
        )
        return Status(401, {"detail": GENERIC_LOGIN_ERROR})

    if (
        membership.role
        in {
            Membership.Role.KEPALA_KONVEKSI,
            Membership.Role.OPERATOR,
        }
        and Membership.objects.filter(user=user, is_active=True)
        .exclude(tenant=tenant)
        .exists()
    ):
        _record_failed_attempt(ip_address, username)
        _audit_session_event(
            action="login_failed",
            request=request,
            user=user,
            tenant=tenant,
            detail={"reason": "single_tenant_role_violation"},
        )
        return Status(401, {"detail": GENERIC_LOGIN_ERROR})

    login(request, user)
    request.session["active_tenant_id"] = tenant.id
    _clear_failed_attempts(ip_address, username)

    _audit_session_event(
        action="login_success",
        request=request,
        user=user,
        tenant=tenant,
        detail={"role": membership.role},
    )

    return _session_response(user, tenant, membership.role)


@router.get(
    "/me",
    response={200: UserResponse, 401: ErrorResponse, 403: ErrorResponse},
    auth=None,
    summary="Session info",
)
def get_me(request: HttpRequest):
    get_token(request)

    if not request.user.is_authenticated:
        return Status(401, {"detail": "Belum login."})

    tenant_id = request.session.get("active_tenant_id")
    if not tenant_id:
        return Status(401, {"detail": "Sesi tidak memiliki tenant aktif."})

    tenant = Tenant.objects.filter(id=tenant_id, is_active=True).first()
    if tenant is None:
        return Status(401, {"detail": "Tenant tidak ditemukan atau tidak aktif."})

    membership = get_effective_membership(request.user, tenant)
    if membership is None:
        return Status(403, {"detail": "Keanggotaan tidak aktif."})

    return _session_response(request.user, tenant, membership.role)


@router.get(
    "/capabilities",
    response={200: CapabilityResponse, 401: ErrorResponse, 403: ErrorResponse},
    auth=None,
    summary="Capability sesi aktif",
)
def get_capabilities(request: HttpRequest):
    get_token(request)

    if not request.user.is_authenticated:
        return Status(401, {"detail": "Belum login."})

    tenant_id = request.session.get("active_tenant_id")
    if not tenant_id:
        return Status(401, {"detail": "Sesi tidak memiliki tenant aktif."})

    tenant = Tenant.objects.filter(id=tenant_id, is_active=True).first()
    if tenant is None:
        return Status(401, {"detail": "Tenant tidak ditemukan atau tidak aktif."})

    membership = get_effective_membership(request.user, tenant)
    if membership is None:
        return Status(403, {"detail": "Keanggotaan tidak aktif."})

    operator_context = (
        resolve_operator_context(tenant, request.user)
        if membership.role == Membership.Role.OPERATOR
        else None
    )
    operator = operator_context.operator if operator_context is not None else None
    full_name = request.user.get_full_name() or request.user.username
    return {
        "user": {
            "id": request.user.id,
            "username": request.user.username,
            "full_name": full_name,
        },
        "tenant": {
            "id": tenant.id,
            "slug": tenant.slug,
            "name": tenant.name,
        },
        "role": membership.role,
        "operator": (
            {
                "id": str(operator.id),
                "name": operator.name,
                "operator_type": operator.operator_type,
                "status": operator.status,
                "is_active": operator.is_active,
                "supervisor_id": str(operator.supervisor_id)
                if operator.supervisor_id
                else None,
            }
            if operator is not None
            else None
        ),
        "capabilities": capabilities_for(membership.role, operator_context),
    }


@router.get(
    "/available-tenants",
    response={200: list[TenantResponse], 401: ErrorResponse},
    auth=django_auth,
    summary="Daftar tenant yang dapat diakses sesi",
)
def get_available_tenants(request: HttpRequest):
    """Pilihan perpindahan tenant berasal dari hak efektif sesi user."""
    tenant_id = request.session.get("active_tenant_id")
    if not tenant_id:
        return Status(401, {"detail": "Sesi tidak memiliki tenant aktif."})
    if request.user.is_superuser:
        return list(Tenant.objects.filter(is_active=True).values("slug", "name"))
    memberships = Membership.objects.filter(
        user=request.user,
        is_active=True,
        tenant__is_active=True,
    ).select_related("tenant")
    return [
        {"slug": membership.tenant.slug, "name": membership.tenant.name}
        for membership in memberships.order_by("tenant__name")
    ]


@router.post(
    "/switch-tenant",
    response={200: UserResponse, 403: ErrorResponse, 404: ErrorResponse},
    auth=django_auth,
    summary="Pindah konteks tenant",
)
def switch_tenant(request: HttpRequest, payload: SwitchTenantRequest):
    current_tenant_id = request.session.get("active_tenant_id")
    current_tenant = Tenant.objects.filter(id=current_tenant_id, is_active=True).first()
    current_membership = (
        get_effective_membership(request.user, current_tenant)
        if current_tenant is not None
        else None
    )
    if current_membership is None:
        return Status(403, {"detail": "Sesi tenant tidak valid."})
    if current_membership.role not in {
        Membership.Role.SUPER_ADMIN,
        Membership.Role.FINANCE,
    }:
        _audit_session_event(
            action="tenant_switch_denied",
            request=request,
            user=request.user,
            tenant=current_tenant,
        )
        return Status(403, {"detail": "Peran ini tidak dapat berpindah konveksi."})
    target_tenant = Tenant.objects.filter(
        slug=payload.tenant_slug,
        is_active=True,
    ).first()
    target_membership = (
        get_effective_membership(request.user, target_tenant)
        if target_tenant is not None
        else None
    )
    if target_membership is None:
        return Status(404, {"detail": "Konveksi tidak ditemukan."})
    request.session.cycle_key()
    request.session["active_tenant_id"] = target_membership.tenant_id
    _audit_session_event(
        action="tenant_switched",
        request=request,
        user=request.user,
        tenant=target_membership.tenant,
        detail={
            "before_tenant_id": current_tenant_id,
            "after_tenant_id": target_membership.tenant_id,
        },
    )
    return _session_response(
        request.user, target_membership.tenant, target_membership.role
    )


@router.post(
    "/logout",
    response={200: ErrorResponse, 401: ErrorResponse},
    auth=django_auth,
    summary="Logout",
)
def api_logout(request: HttpRequest):
    tenant_id = request.session.get("active_tenant_id")
    tenant = Tenant.objects.filter(id=tenant_id).first() if tenant_id else None

    _audit_session_event(
        action="logout",
        request=request,
        user=request.user if request.user.is_authenticated else None,
        tenant=tenant,
    )

    logout(request)
    return {"detail": "ok"}


@router.post(
    "/change-password",
    response={
        200: ErrorResponse,
        400: ErrorResponse,
        401: ErrorResponse,
        429: ErrorResponse,
    },
    auth=django_auth,
    summary="Ganti password akun sendiri",
)
def change_password(request: HttpRequest, payload: ChangePasswordRequest):
    tenant = Tenant.objects.filter(id=request.session.get("active_tenant_id")).first()
    if password_verification_is_limited(request):
        _audit_session_event(
            action="password_verification_rate_limited",
            request=request,
            user=request.user,
            tenant=tenant,
            detail={"operation": "change_password"},
        )
        return Status(
            429,
            {"detail": "Terlalu banyak percobaan verifikasi. Coba lagi nanti."},
        )
    if payload.new_password != payload.new_password_confirmation:
        return Status(400, {"detail": "Konfirmasi password baru tidak sama."})
    if not request.user.check_password(payload.current_password):
        record_password_verification_failure(request)
        _audit_session_event(
            action="password_change_failed",
            request=request,
            user=request.user,
            tenant=tenant,
            detail={"reason": "current_password_invalid"},
        )
        return Status(400, {"detail": "Password lama tidak valid."})

    clear_password_verification_failures(request)

    try:
        validate_password(payload.new_password, user=request.user)
    except ValidationError as exc:
        return Status(400, {"detail": " ".join(exc.messages)})

    request.user.set_password(payload.new_password)
    request.user.save(update_fields=["password"])
    update_session_auth_hash(request, request.user)
    _audit_session_event(
        action="password_changed",
        request=request,
        user=request.user,
        tenant=tenant,
    )
    return {"detail": "Password berhasil diubah."}
