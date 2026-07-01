"""API administrasi konveksi, pengguna, membership, dan operator."""

import json

from typing import Any
from uuid import UUID

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Count, Q
from django.core.serializers.json import DjangoJSONEncoder
from django.http import HttpRequest
from django.utils.text import slugify
from ninja import Router, Schema, Status
from ninja.errors import HttpError
from pydantic import Field

from backend.core.access import (
    ROLE_KEPALA,
    ROLE_SUPER_ADMIN,
    require_capability,
    tenant_session_auth,
)
from backend.core.models import AuditEvent, Membership, Tenant, User
from backend.api.auth import (
    clear_password_verification_failures,
    password_verification_is_limited,
    record_password_verification_failure,
)
from backend.masterdata.models import Operator
from backend.masterdata.services import bootstrap_tenant

router = Router(tags=["Administration"], auth=tenant_session_auth)

ROLE_FINANCE = Membership.Role.FINANCE
ROLE_OPERATOR = Membership.Role.OPERATOR
MANAGED_USER_ROLES = {ROLE_KEPALA, ROLE_FINANCE}
OPERATOR_MANAGERS = {ROLE_SUPER_ADMIN, ROLE_KEPALA}
PAGE_SIZE_MAX = 100


class ErrorResponse(Schema):
    detail: str


class DeletionEligibility(Schema):
    can_delete: bool
    blockers: list[str]


class ReasonPayload(Schema):
    reason: str = Field(min_length=3, max_length=500)


class DeletePayload(ReasonPayload):
    confirmation: str = Field(min_length=1, max_length=200)
    actor_password: str = Field(min_length=1, max_length=256)


class TenantAdminResponse(Schema):
    id: int
    name: str
    slug: str
    code: str
    address: str
    phone: str
    is_active: bool
    user_count: int
    deletion_eligibility: DeletionEligibility


class TenantPageResponse(Schema):
    items: list[TenantAdminResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class TenantCreatePayload(Schema):
    name: str = Field(min_length=2, max_length=200)
    slug: str = Field(default="", max_length=100)
    code: str = Field(min_length=1, max_length=12)
    address: str = Field(default="", max_length=2000)
    phone: str = Field(default="", max_length=30)


class TenantUpdatePayload(Schema):
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(min_length=1, max_length=12)
    address: str = Field(default="", max_length=2000)
    phone: str = Field(default="", max_length=30)


class MembershipAdminResponse(Schema):
    id: int
    tenant_id: int
    tenant_name: str
    tenant_slug: str
    role: str
    is_active: bool


class UserAdminResponse(Schema):
    id: int
    username: str
    first_name: str
    last_name: str
    full_name: str
    email: str
    role: str
    is_active: bool
    managed_by_server: bool
    editable: bool
    memberships: list[MembershipAdminResponse]
    deletion_eligibility: DeletionEligibility


class UserPageResponse(Schema):
    items: list[UserAdminResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class UserCreatePayload(Schema):
    username: str = Field(min_length=3, max_length=150)
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(default="", max_length=150)
    email: str = Field(default="", max_length=254)
    password: str = Field(min_length=8, max_length=256)
    password_confirmation: str = Field(min_length=8, max_length=256)
    role: str
    tenant_ids: list[int] = Field(min_length=1)


class UserUpdatePayload(Schema):
    username: str = Field(min_length=3, max_length=150)
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(default="", max_length=150)
    email: str = Field(default="", max_length=254)
    role: str
    tenant_ids: list[int] = Field(min_length=1)


class ResetPasswordPayload(Schema):
    new_password: str = Field(min_length=8, max_length=256)
    new_password_confirmation: str = Field(min_length=8, max_length=256)
    actor_password: str = Field(min_length=1, max_length=256)


class OperatorAdminResponse(Schema):
    id: UUID
    user_id: int
    username: str
    first_name: str
    last_name: str
    full_name: str
    email: str
    operator_type: str
    status: str
    supervisor_id: UUID | None
    supervisor_name: str
    location: str
    phone: str
    account_is_active: bool
    work_is_active: bool
    deletion_eligibility: DeletionEligibility


class OperatorPageResponse(Schema):
    items: list[OperatorAdminResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class OperatorCreatePayload(Schema):
    username: str = Field(min_length=3, max_length=150)
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(default="", max_length=150)
    email: str = Field(default="", max_length=254)
    password: str = Field(min_length=8, max_length=256)
    password_confirmation: str = Field(min_length=8, max_length=256)
    operator_type: str
    status: str
    supervisor_id: UUID | None = None
    location: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=30)
    account_is_active: bool = True
    work_is_active: bool = True


class OperatorUpdatePayload(Schema):
    username: str = Field(min_length=3, max_length=150)
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(default="", max_length=150)
    email: str = Field(default="", max_length=254)
    operator_type: str
    status: str
    supervisor_id: UUID | None = None
    location: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=30)
    work_is_active: bool = True


def _page_values(page: int, page_size: int, total: int) -> tuple[int, int, int, int]:
    normalized_page = max(page, 1)
    normalized_size = min(max(page_size, 1), PAGE_SIZE_MAX)
    total_pages = max((total + normalized_size - 1) // normalized_size, 1)
    normalized_page = min(normalized_page, total_pages)
    offset = (normalized_page - 1) * normalized_size
    return normalized_page, normalized_size, total_pages, offset


def _audit(
    request: HttpRequest,
    *,
    action: str,
    resource_type: str,
    resource_id: str,
    tenant: Tenant | None,
    detail: dict[str, Any],
) -> None:
    AuditEvent.objects.create(
        tenant=tenant,
        user=request.user,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=json.loads(json.dumps(detail, cls=DjangoJSONEncoder)),
        ip_address=request.META.get("REMOTE_ADDR"),
        request_id=getattr(request, "request_id", ""),
    )


def _require_admin_capability(request: HttpRequest, capability: str):
    return require_capability(request, capability)


def _validate_email(email: str) -> str:
    value = email.strip()
    if value:
        try:
            validate_email(value)
        except ValidationError as exc:
            raise HttpError(422, "Alamat email tidak valid.") from exc
    return value


def _validate_password(user: User, password: str, confirmation: str) -> None:
    if password != confirmation:
        raise HttpError(422, "Konfirmasi password tidak sama.")
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        raise HttpError(422, " ".join(exc.messages)) from exc


def _verify_actor_password(request: HttpRequest, password: str) -> None:
    if password_verification_is_limited(request):
        _audit(
            request,
            action="password_verification_rate_limited",
            resource_type="User",
            resource_id=str(request.user.pk),
            tenant=getattr(request, "tenant_context", None).tenant
            if getattr(request, "tenant_context", None)
            else None,
            detail={"operation": "administration_step_up"},
        )
        raise HttpError(429, "Terlalu banyak percobaan verifikasi. Coba lagi nanti.")
    if request.user.check_password(password):
        clear_password_verification_failures(request)
        return
    record_password_verification_failure(request)
    _audit(
        request,
        action="step_up_auth_failed",
        resource_type="User",
        resource_id=str(request.user.pk),
        tenant=getattr(request, "tenant_context", None).tenant
        if getattr(request, "tenant_context", None)
        else None,
        detail={"reason": "password_invalid"},
    )
    raise HttpError(403, "Verifikasi password pelaksana gagal.")


BOOTSTRAP_TENANT_MODELS = {
    "core.AuditEvent",
    "core.BusinessPolicy",
    "core.Membership",
    "core.OutboxEvent",
    "masterdata.UOM",
    "masterdata.ChartOfAccount",
    "masterdata.BankAccount",
    "inventory.Warehouse",
    "accounting.AccountingMapping",
    "accounting.AccountingPeriod",
}


def _tenant_deletion_eligibility(tenant: Tenant, actor: User) -> dict[str, Any]:
    blockers: list[str] = []
    other_memberships = tenant.memberships.exclude(user=actor)
    if other_memberships.exists():
        blockers.append("Konveksi masih memiliki pengguna lain.")

    for relation in tenant._meta.related_objects:
        model = relation.related_model
        label = model._meta.label
        if label in BOOTSTRAP_TENANT_MODELS:
            continue
        lookup = {relation.field.name: tenant}
        if model._default_manager.filter(**lookup).exists():
            blockers.append(f"Masih terdapat data {model._meta.verbose_name_plural}.")

    return {"can_delete": not blockers, "blockers": blockers}


def _tenant_response(tenant: Tenant, actor: User) -> dict[str, Any]:
    user_count = getattr(tenant, "user_count", None)
    if user_count is None:
        user_count = tenant.memberships.filter(is_active=True).count()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "code": tenant.code,
        "address": tenant.address,
        "phone": tenant.phone,
        "is_active": tenant.is_active,
        "user_count": user_count,
        "deletion_eligibility": _tenant_deletion_eligibility(tenant, actor),
    }


@router.get("/tenants", response=TenantPageResponse)
def list_tenants(
    request: HttpRequest,
    q: str = "",
    status: str = "all",
    page: int = 1,
    page_size: int = 20,
    sort: str = "name",
):
    _require_admin_capability(request, "settings.tenants.read")
    queryset = Tenant.objects.annotate(
        user_count=Count("memberships", filter=Q(memberships__is_active=True))
    )
    if q.strip():
        queryset = queryset.filter(
            Q(name__icontains=q.strip())
            | Q(slug__icontains=q.strip())
            | Q(code__icontains=q.strip())
        )
    if status == "active":
        queryset = queryset.filter(is_active=True)
    elif status == "inactive":
        queryset = queryset.filter(is_active=False)
    ordering = {"name": "name", "-name": "-name", "created": "-created_at"}.get(
        sort, "name"
    )
    queryset = queryset.order_by(ordering)
    total = queryset.count()
    normalized_page, normalized_size, total_pages, offset = _page_values(
        page, page_size, total
    )
    items = queryset[offset : offset + normalized_size]
    return {
        "items": [_tenant_response(item, request.user) for item in items],
        "total": total,
        "page": normalized_page,
        "page_size": normalized_size,
        "total_pages": total_pages,
    }


@router.post("/tenants", response={201: TenantAdminResponse, 409: ErrorResponse})
@transaction.atomic
def create_tenant(request: HttpRequest, payload: TenantCreatePayload):
    _require_admin_capability(request, "settings.tenants.create")
    slug = slugify(payload.slug or payload.name)[:100]
    if not slug:
        raise HttpError(422, "Slug konveksi tidak valid.")
    if Tenant.objects.filter(slug=slug).exists():
        return Status(409, {"detail": "Slug konveksi sudah digunakan."})

    tenant = Tenant.objects.create(
        name=payload.name.strip(),
        slug=slug,
        code=payload.code.strip().upper(),
        address=payload.address.strip(),
        phone=payload.phone.strip(),
    )
    Membership.objects.create(
        user=request.user,
        tenant=tenant,
        role=Membership.Role.SUPER_ADMIN,
        is_active=True,
    )
    bootstrap_tenant(tenant)
    _audit(
        request,
        action="tenant_created",
        resource_type="Tenant",
        resource_id=str(tenant.pk),
        tenant=tenant,
        detail={"after": _tenant_response(tenant, request.user)},
    )
    return Status(201, _tenant_response(tenant, request.user))


@router.get("/tenants/{tenant_id}", response=TenantAdminResponse)
def get_tenant(request: HttpRequest, tenant_id: int):
    _require_admin_capability(request, "settings.tenants.read")
    tenant = Tenant.objects.filter(pk=tenant_id).first()
    if tenant is None:
        raise HttpError(404, "Konveksi tidak ditemukan.")
    return _tenant_response(tenant, request.user)


@router.patch("/tenants/{tenant_id}", response=TenantAdminResponse)
@transaction.atomic
def update_tenant(request: HttpRequest, tenant_id: int, payload: TenantUpdatePayload):
    _require_admin_capability(request, "settings.tenants.update")
    tenant = Tenant.objects.select_for_update().filter(pk=tenant_id).first()
    if tenant is None:
        raise HttpError(404, "Konveksi tidak ditemukan.")
    before = _tenant_response(tenant, request.user)
    tenant.name = payload.name.strip()
    tenant.code = payload.code.strip().upper()
    tenant.address = payload.address.strip()
    tenant.phone = payload.phone.strip()
    tenant.save(update_fields=["name", "code", "address", "phone", "updated_at"])
    after = _tenant_response(tenant, request.user)
    _audit(
        request,
        action="tenant_updated",
        resource_type="Tenant",
        resource_id=str(tenant.pk),
        tenant=tenant,
        detail={"before": before, "after": after},
    )
    return after


@router.post("/tenants/{tenant_id}/activate", response=TenantAdminResponse)
@transaction.atomic
def activate_tenant(request: HttpRequest, tenant_id: int, payload: ReasonPayload):
    _require_admin_capability(request, "settings.tenants.activate")
    tenant = Tenant.objects.select_for_update().filter(pk=tenant_id).first()
    if tenant is None:
        raise HttpError(404, "Konveksi tidak ditemukan.")
    tenant.is_active = True
    tenant.save(update_fields=["is_active", "updated_at"])
    _audit(
        request,
        action="tenant_activated",
        resource_type="Tenant",
        resource_id=str(tenant.pk),
        tenant=tenant,
        detail={"reason": payload.reason.strip()},
    )
    return _tenant_response(tenant, request.user)


@router.post("/tenants/{tenant_id}/deactivate", response=TenantAdminResponse)
@transaction.atomic
def deactivate_tenant(request: HttpRequest, tenant_id: int, payload: ReasonPayload):
    context = _require_admin_capability(request, "settings.tenants.deactivate")
    tenant = Tenant.objects.select_for_update().filter(pk=tenant_id).first()
    if tenant is None:
        raise HttpError(404, "Konveksi tidak ditemukan.")
    if tenant.pk == context.tenant_id:
        raise HttpError(
            409, "Pindah ke konveksi lain sebelum menonaktifkan konveksi aktif."
        )
    if tenant.is_active and Tenant.objects.filter(is_active=True).count() <= 1:
        raise HttpError(409, "Konveksi aktif terakhir tidak dapat dinonaktifkan.")
    tenant.is_active = False
    tenant.save(update_fields=["is_active", "updated_at"])
    _audit(
        request,
        action="tenant_deactivated",
        resource_type="Tenant",
        resource_id=str(tenant.pk),
        tenant=tenant,
        detail={"reason": payload.reason.strip()},
    )
    return _tenant_response(tenant, request.user)


@router.delete(
    "/tenants/{tenant_id}", response={200: ErrorResponse, 409: ErrorResponse}
)
@transaction.atomic
def delete_tenant(request: HttpRequest, tenant_id: int, payload: DeletePayload):
    context = _require_admin_capability(request, "settings.tenants.delete")
    _verify_actor_password(request, payload.actor_password)
    tenant = Tenant.objects.select_for_update().filter(pk=tenant_id).first()
    if tenant is None:
        raise HttpError(404, "Konveksi tidak ditemukan.")
    if tenant.pk == context.tenant_id:
        return Status(409, {"detail": "Konveksi aktif tidak dapat dihapus."})
    if payload.confirmation.strip() != tenant.name:
        return Status(409, {"detail": "Konfirmasi nama konveksi tidak cocok."})
    eligibility = _tenant_deletion_eligibility(tenant, request.user)
    if not eligibility["can_delete"]:
        return Status(409, {"detail": " ".join(eligibility["blockers"])})
    snapshot = _tenant_response(tenant, request.user)
    resource_id = str(tenant.pk)
    tenant.delete()
    _audit(
        request,
        action="tenant_deleted",
        resource_type="Tenant",
        resource_id=resource_id,
        tenant=None,
        detail={"before": snapshot, "reason": payload.reason.strip()},
    )
    return {"detail": "Konveksi berhasil dihapus."}


def _managed_by_server(user: User, memberships: list[Membership] | None = None) -> bool:
    if user.is_superuser:
        return True
    queryset = memberships if memberships is not None else user.memberships.all()
    return any(item.role == ROLE_SUPER_ADMIN for item in queryset)


def _user_deletion_eligibility(user: User, actor: User) -> dict[str, Any]:
    blockers: list[str] = []
    if user.pk == actor.pk:
        blockers.append("Akun sendiri tidak dapat dihapus.")
    if _managed_by_server(user):
        blockers.append("Akun Super Admin dikelola melalui server.")
    if user.last_login is not None:
        blockers.append("Akun sudah pernah digunakan untuk login.")
    if user.audit_events.exists():
        blockers.append("Akun memiliki aktivitas audit.")

    allowed_models = {"core.Membership"}
    for relation in user._meta.related_objects:
        label = relation.related_model._meta.label
        if label in allowed_models or label == "core.AuditEvent":
            continue
        lookup = {relation.field.name: user}
        if relation.related_model._default_manager.filter(**lookup).exists():
            blockers.append(
                f"Akun masih terkait dengan {relation.related_model._meta.verbose_name_plural}."
            )
    return {"can_delete": not blockers, "blockers": blockers}


def _membership_response(membership: Membership) -> dict[str, Any]:
    return {
        "id": membership.id,
        "tenant_id": membership.tenant_id,
        "tenant_name": membership.tenant.name,
        "tenant_slug": membership.tenant.slug,
        "role": membership.role,
        "is_active": membership.is_active,
    }


def _user_response(user: User, actor: User) -> dict[str, Any]:
    memberships = list(
        user.memberships.select_related("tenant").order_by("tenant__name")
    )
    active_role = next((item.role for item in memberships if item.is_active), "")
    managed = _managed_by_server(user, memberships)
    return {
        "id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.get_full_name() or user.username,
        "email": user.email,
        "role": active_role,
        "is_active": user.is_active,
        "managed_by_server": managed,
        "editable": not managed and user.pk != actor.pk,
        "memberships": [_membership_response(item) for item in memberships],
        "deletion_eligibility": _user_deletion_eligibility(user, actor),
    }


def _validate_managed_role(role: str, tenant_ids: list[int]) -> list[Tenant]:
    unique_ids = list(dict.fromkeys(tenant_ids))
    if role not in MANAGED_USER_ROLES:
        raise HttpError(
            422, "Pengguna umum hanya dapat menjadi Kepala Konveksi atau Finance."
        )
    if role == ROLE_KEPALA and len(unique_ids) != 1:
        raise HttpError(422, "Kepala Konveksi wajib memiliki tepat satu konveksi.")
    tenants = list(Tenant.objects.filter(id__in=unique_ids, is_active=True))
    if len(tenants) != len(unique_ids):
        raise HttpError(422, "Satu atau lebih konveksi tidak tersedia.")
    return tenants


@router.get("/users", response=UserPageResponse)
def list_users(
    request: HttpRequest,
    q: str = "",
    tenant_id: int | None = None,
    role: str = "all",
    status: str = "all",
    page: int = 1,
    page_size: int = 20,
    sort: str = "name",
):
    _require_admin_capability(request, "settings.users.read")
    queryset = User.objects.all().distinct()
    if q.strip():
        term = q.strip()
        queryset = queryset.filter(
            Q(username__icontains=term)
            | Q(first_name__icontains=term)
            | Q(last_name__icontains=term)
        )
    if tenant_id is not None:
        queryset = queryset.filter(memberships__tenant_id=tenant_id)
    if role != "all":
        queryset = queryset.filter(memberships__role=role, memberships__is_active=True)
    if status == "active":
        queryset = queryset.filter(is_active=True)
    elif status == "inactive":
        queryset = queryset.filter(is_active=False)
    ordering = {
        "name": "first_name",
        "-name": "-first_name",
        "username": "username",
        "-username": "-username",
    }.get(sort, "first_name")
    queryset = queryset.order_by(ordering, "username")
    total = queryset.count()
    normalized_page, normalized_size, total_pages, offset = _page_values(
        page, page_size, total
    )
    items = queryset[offset : offset + normalized_size]
    return {
        "items": [_user_response(item, request.user) for item in items],
        "total": total,
        "page": normalized_page,
        "page_size": normalized_size,
        "total_pages": total_pages,
    }


@router.post("/users", response={201: UserAdminResponse, 409: ErrorResponse})
@transaction.atomic
def create_user(request: HttpRequest, payload: UserCreatePayload):
    _require_admin_capability(request, "settings.users.create")
    tenants = _validate_managed_role(payload.role, payload.tenant_ids)
    if User.objects.filter(username__iexact=payload.username.strip()).exists():
        return Status(409, {"detail": "Username sudah digunakan."})
    user = User(
        username=payload.username.strip(),
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        email=_validate_email(payload.email),
        is_active=True,
    )
    _validate_password(user, payload.password, payload.password_confirmation)
    user.set_password(payload.password)
    user.save()
    for tenant in tenants:
        Membership.objects.create(user=user, tenant=tenant, role=payload.role)
    response = _user_response(user, request.user)
    _audit(
        request,
        action="user_created",
        resource_type="User",
        resource_id=str(user.pk),
        tenant=getattr(request, "tenant_context").tenant,
        detail={"after": response},
    )
    return Status(201, response)


def _get_editable_user(user_id: int, actor: User) -> User:
    user = User.objects.select_for_update().filter(pk=user_id).first()
    if user is None:
        raise HttpError(404, "Pengguna tidak ditemukan.")
    if _managed_by_server(user):
        raise HttpError(403, "Akun Super Admin dikelola melalui server.")
    if user.operator_profiles.exists():
        raise HttpError(409, "Kelola akun Operator melalui halaman Operator.")
    if user.pk == actor.pk:
        raise HttpError(409, "Akun sendiri tidak dapat diubah melalui halaman ini.")
    return user


@router.get("/users/{user_id}", response=UserAdminResponse)
def get_user(request: HttpRequest, user_id: int):
    _require_admin_capability(request, "settings.users.read")
    user = User.objects.filter(pk=user_id).first()
    if user is None:
        raise HttpError(404, "Pengguna tidak ditemukan.")
    return _user_response(user, request.user)


@router.patch("/users/{user_id}", response=UserAdminResponse)
@transaction.atomic
def update_user(request: HttpRequest, user_id: int, payload: UserUpdatePayload):
    _require_admin_capability(request, "settings.users.update")
    user = _get_editable_user(user_id, request.user)
    tenants = _validate_managed_role(payload.role, payload.tenant_ids)
    if (
        User.objects.filter(username__iexact=payload.username.strip())
        .exclude(pk=user.pk)
        .exists()
    ):
        raise HttpError(409, "Username sudah digunakan.")
    before = _user_response(user, request.user)
    user.username = payload.username.strip()
    user.first_name = payload.first_name.strip()
    user.last_name = payload.last_name.strip()
    user.email = _validate_email(payload.email)
    user.save(update_fields=["username", "first_name", "last_name", "email"])
    user.memberships.update(is_active=False)
    for tenant in tenants:
        membership, _created = Membership.objects.get_or_create(
            user=user,
            tenant=tenant,
            defaults={"role": payload.role, "is_active": True},
        )
        membership.role = payload.role
        membership.is_active = True
        membership.save(update_fields=["role", "is_active"])
    after = _user_response(user, request.user)
    _audit(
        request,
        action="user_updated",
        resource_type="User",
        resource_id=str(user.pk),
        tenant=getattr(request, "tenant_context").tenant,
        detail={"before": before, "after": after},
    )
    return after


def _set_user_active(
    request: HttpRequest, user_id: int, payload: ReasonPayload, *, active: bool
) -> dict[str, Any]:
    _require_admin_capability(
        request, "settings.users.activate" if active else "settings.users.deactivate"
    )
    user = _get_editable_user(user_id, request.user)
    user.is_active = active
    user.save(update_fields=["is_active"])
    action = "user_activated" if active else "user_deactivated"
    _audit(
        request,
        action=action,
        resource_type="User",
        resource_id=str(user.pk),
        tenant=getattr(request, "tenant_context").tenant,
        detail={"reason": payload.reason.strip()},
    )
    return _user_response(user, request.user)


@router.post("/users/{user_id}/activate", response=UserAdminResponse)
@transaction.atomic
def activate_user(request: HttpRequest, user_id: int, payload: ReasonPayload):
    return _set_user_active(request, user_id, payload, active=True)


@router.post("/users/{user_id}/deactivate", response=UserAdminResponse)
@transaction.atomic
def deactivate_user(request: HttpRequest, user_id: int, payload: ReasonPayload):
    return _set_user_active(request, user_id, payload, active=False)


@router.post("/users/{user_id}/reset-password", response=ErrorResponse)
@transaction.atomic
def reset_user_password(
    request: HttpRequest, user_id: int, payload: ResetPasswordPayload
):
    _require_admin_capability(request, "settings.users.reset_password")
    _verify_actor_password(request, payload.actor_password)
    user = User.objects.select_for_update().filter(pk=user_id).first()
    if user is None:
        raise HttpError(404, "Pengguna tidak ditemukan.")
    if user.pk == request.user.pk:
        raise HttpError(409, "Gunakan menu Ganti Password untuk akun sendiri.")
    if _managed_by_server(user):
        raise HttpError(403, "Akun Super Admin dikelola melalui server.")
    _validate_password(user, payload.new_password, payload.new_password_confirmation)
    user.set_password(payload.new_password)
    user.save(update_fields=["password"])
    _audit(
        request,
        action="user_password_reset",
        resource_type="User",
        resource_id=str(user.pk),
        tenant=getattr(request, "tenant_context").tenant,
        detail={"target_username": user.username},
    )
    return {"detail": "Password pengguna berhasil direset."}


@router.delete("/users/{user_id}", response={200: ErrorResponse, 409: ErrorResponse})
@transaction.atomic
def delete_user(request: HttpRequest, user_id: int, payload: DeletePayload):
    _require_admin_capability(request, "settings.users.delete")
    _verify_actor_password(request, payload.actor_password)
    user = User.objects.select_for_update().filter(pk=user_id).first()
    if user is None:
        raise HttpError(404, "Pengguna tidak ditemukan.")
    if payload.confirmation.strip() != user.username:
        return Status(409, {"detail": "Konfirmasi username tidak cocok."})
    eligibility = _user_deletion_eligibility(user, request.user)
    if not eligibility["can_delete"]:
        return Status(409, {"detail": " ".join(eligibility["blockers"])})
    snapshot = _user_response(user, request.user)
    resource_id = str(user.pk)
    user.delete()
    _audit(
        request,
        action="user_deleted",
        resource_type="User",
        resource_id=resource_id,
        tenant=getattr(request, "tenant_context").tenant,
        detail={"before": snapshot, "reason": payload.reason.strip()},
    )
    return {"detail": "Pengguna berhasil dihapus."}


def _operator_deletion_eligibility(operator: Operator, actor: User) -> dict[str, Any]:
    blockers: list[str] = []
    user = operator.user
    if user.pk == actor.pk:
        blockers.append("Akun sendiri tidak dapat dihapus.")
    if user.last_login is not None:
        blockers.append("Akun Operator sudah pernah digunakan untuk login.")
    if user.audit_events.exists():
        blockers.append("Akun Operator memiliki aktivitas audit.")
    if operator.team_members.exists():
        blockers.append("Operator masih menjadi supervisor.")
    for relation in operator._meta.related_objects:
        if relation.related_model is Operator:
            continue
        lookup = {relation.field.name: operator}
        if relation.related_model._default_manager.filter(**lookup).exists():
            blockers.append(
                f"Operator masih terkait dengan {relation.related_model._meta.verbose_name_plural}."
            )
    if user.memberships.count() != 1:
        blockers.append("Akun Operator memiliki membership lain.")
    return {"can_delete": not blockers, "blockers": blockers}


def _operator_response(operator: Operator, actor: User) -> dict[str, Any]:
    user = operator.user
    return {
        "id": operator.id,
        "user_id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.get_full_name() or user.username,
        "email": user.email,
        "operator_type": operator.operator_type,
        "status": operator.status,
        "supervisor_id": operator.supervisor_id,
        "supervisor_name": operator.supervisor.name if operator.supervisor else "",
        "location": operator.location,
        "phone": operator.phone,
        "account_is_active": user.is_active,
        "work_is_active": operator.is_active,
        "deletion_eligibility": _operator_deletion_eligibility(operator, actor),
    }


def _validate_operator_fields(
    *,
    tenant: Tenant,
    operator_type: str,
    status: str,
    supervisor_id: UUID | None,
    current_id: UUID | None = None,
) -> Operator | None:
    if operator_type not in Operator.OperatorType.values:
        raise HttpError(422, "Fungsi Operator tidak valid.")
    if status not in Operator.OperatorStatus.values:
        raise HttpError(422, "Status Operator tidak valid.")
    if supervisor_id is None:
        return None
    supervisor = Operator.objects.filter(
        tenant=tenant,
        id=supervisor_id,
        operator_type=Operator.OperatorType.MANDOR,
        is_active=True,
    ).first()
    if supervisor is None or supervisor.id == current_id:
        raise HttpError(422, "Supervisor harus Mandor aktif dari konveksi yang sama.")
    return supervisor


def _get_scoped_operator(context, operator_id: UUID, *, lock: bool = False):
    queryset = Operator.objects.select_related("user", "supervisor").filter(
        tenant=context.tenant, id=operator_id
    )
    if lock:
        queryset = queryset.select_for_update(of=("self",))
    operator = queryset.first()
    if operator is None:
        raise HttpError(404, "Operator tidak ditemukan.")
    return operator


@router.get("/operators", response=OperatorPageResponse)
def list_admin_operators(
    request: HttpRequest,
    q: str = "",
    operator_type: str = "all",
    work_status: str = "all",
    account_status: str = "all",
    page: int = 1,
    page_size: int = 20,
    sort: str = "name",
):
    context = _require_admin_capability(request, "settings.operators.read")
    queryset = Operator.objects.filter(tenant=context.tenant).select_related(
        "user", "supervisor"
    )
    if q.strip():
        term = q.strip()
        queryset = queryset.filter(
            Q(name__icontains=term) | Q(user__username__icontains=term)
        )
    if operator_type != "all":
        queryset = queryset.filter(operator_type=operator_type)
    if work_status == "active":
        queryset = queryset.filter(is_active=True)
    elif work_status == "inactive":
        queryset = queryset.filter(is_active=False)
    if account_status == "active":
        queryset = queryset.filter(user__is_active=True)
    elif account_status == "inactive":
        queryset = queryset.filter(user__is_active=False)
    ordering = {"name": "name", "-name": "-name", "username": "user__username"}.get(
        sort, "name"
    )
    queryset = queryset.order_by(ordering)
    total = queryset.count()
    normalized_page, normalized_size, total_pages, offset = _page_values(
        page, page_size, total
    )
    items = queryset[offset : offset + normalized_size]
    return {
        "items": [_operator_response(item, request.user) for item in items],
        "total": total,
        "page": normalized_page,
        "page_size": normalized_size,
        "total_pages": total_pages,
    }


@router.post("/operators", response={201: OperatorAdminResponse, 409: ErrorResponse})
@transaction.atomic
def create_admin_operator(request: HttpRequest, payload: OperatorCreatePayload):
    context = _require_admin_capability(request, "settings.operators.create")
    supervisor = _validate_operator_fields(
        tenant=context.tenant,
        operator_type=payload.operator_type,
        status=payload.status,
        supervisor_id=payload.supervisor_id,
    )
    if User.objects.filter(username__iexact=payload.username.strip()).exists():
        return Status(409, {"detail": "Username sudah digunakan."})
    user = User(
        username=payload.username.strip(),
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        email=_validate_email(payload.email),
        is_active=payload.account_is_active,
    )
    _validate_password(user, payload.password, payload.password_confirmation)
    user.set_password(payload.password)
    user.save()
    Membership.objects.create(
        user=user,
        tenant=context.tenant,
        role=ROLE_OPERATOR,
        is_active=True,
    )
    operator = Operator.objects.create(
        tenant=context.tenant,
        user=user,
        name=user.get_full_name() or user.username,
        operator_type=payload.operator_type,
        status=payload.status,
        supervisor=supervisor,
        location=payload.location.strip(),
        phone=payload.phone.strip(),
        is_active=payload.work_is_active,
    )
    response = _operator_response(operator, request.user)
    _audit(
        request,
        action="operator_created",
        resource_type="Operator",
        resource_id=str(operator.pk),
        tenant=context.tenant,
        detail={"after": response},
    )
    return Status(201, response)


@router.get("/operators/{operator_id}", response=OperatorAdminResponse)
def get_admin_operator(request: HttpRequest, operator_id: UUID):
    context = _require_admin_capability(request, "settings.operators.read")
    return _operator_response(_get_scoped_operator(context, operator_id), request.user)


@router.patch("/operators/{operator_id}", response=OperatorAdminResponse)
@transaction.atomic
def update_admin_operator(
    request: HttpRequest, operator_id: UUID, payload: OperatorUpdatePayload
):
    context = _require_admin_capability(request, "settings.operators.update")
    operator = _get_scoped_operator(context, operator_id, lock=True)
    supervisor = _validate_operator_fields(
        tenant=context.tenant,
        operator_type=payload.operator_type,
        status=payload.status,
        supervisor_id=payload.supervisor_id,
        current_id=operator.id,
    )
    if (
        User.objects.filter(username__iexact=payload.username.strip())
        .exclude(pk=operator.user_id)
        .exists()
    ):
        raise HttpError(409, "Username sudah digunakan.")
    before = _operator_response(operator, request.user)
    user = operator.user
    user.username = payload.username.strip()
    user.first_name = payload.first_name.strip()
    user.last_name = payload.last_name.strip()
    user.email = _validate_email(payload.email)
    user.save(update_fields=["username", "first_name", "last_name", "email"])
    operator.name = user.get_full_name() or user.username
    operator.operator_type = payload.operator_type
    operator.status = payload.status
    operator.supervisor = supervisor
    operator.location = payload.location.strip()
    operator.phone = payload.phone.strip()
    operator.is_active = payload.work_is_active
    operator.save()
    after = _operator_response(operator, request.user)
    _audit(
        request,
        action="operator_updated",
        resource_type="Operator",
        resource_id=str(operator.pk),
        tenant=context.tenant,
        detail={"before": before, "after": after},
    )
    return after


def _set_operator_account_active(
    request: HttpRequest,
    operator_id: UUID,
    payload: ReasonPayload,
    *,
    active: bool,
) -> dict[str, Any]:
    context = _require_admin_capability(
        request,
        "settings.operators.activate" if active else "settings.operators.deactivate",
    )
    operator = _get_scoped_operator(context, operator_id, lock=True)
    operator.user.is_active = active
    operator.user.save(update_fields=["is_active"])
    _audit(
        request,
        action="operator_account_activated"
        if active
        else "operator_account_deactivated",
        resource_type="Operator",
        resource_id=str(operator.pk),
        tenant=context.tenant,
        detail={"reason": payload.reason.strip(), "user_id": operator.user_id},
    )
    return _operator_response(operator, request.user)


@router.post("/operators/{operator_id}/activate", response=OperatorAdminResponse)
@transaction.atomic
def activate_operator_account(
    request: HttpRequest, operator_id: UUID, payload: ReasonPayload
):
    return _set_operator_account_active(request, operator_id, payload, active=True)


@router.post("/operators/{operator_id}/deactivate", response=OperatorAdminResponse)
@transaction.atomic
def deactivate_operator_account(
    request: HttpRequest, operator_id: UUID, payload: ReasonPayload
):
    return _set_operator_account_active(request, operator_id, payload, active=False)


@router.post("/operators/{operator_id}/reset-password", response=ErrorResponse)
@transaction.atomic
def reset_operator_password(
    request: HttpRequest, operator_id: UUID, payload: ResetPasswordPayload
):
    context = _require_admin_capability(request, "settings.operators.reset_password")
    _verify_actor_password(request, payload.actor_password)
    operator = _get_scoped_operator(context, operator_id, lock=True)
    _validate_password(
        operator.user, payload.new_password, payload.new_password_confirmation
    )
    operator.user.set_password(payload.new_password)
    operator.user.save(update_fields=["password"])
    _audit(
        request,
        action="operator_password_reset",
        resource_type="Operator",
        resource_id=str(operator.pk),
        tenant=context.tenant,
        detail={"user_id": operator.user_id},
    )
    return {"detail": "Password Operator berhasil direset."}


@router.delete(
    "/operators/{operator_id}", response={200: ErrorResponse, 409: ErrorResponse}
)
@transaction.atomic
def delete_admin_operator(
    request: HttpRequest, operator_id: UUID, payload: DeletePayload
):
    context = _require_admin_capability(request, "settings.operators.delete")
    _verify_actor_password(request, payload.actor_password)
    operator = _get_scoped_operator(context, operator_id, lock=True)
    if payload.confirmation.strip() != operator.user.username:
        return Status(409, {"detail": "Konfirmasi username tidak cocok."})
    eligibility = _operator_deletion_eligibility(operator, request.user)
    if not eligibility["can_delete"]:
        return Status(409, {"detail": " ".join(eligibility["blockers"])})
    snapshot = _operator_response(operator, request.user)
    resource_id = str(operator.pk)
    user = operator.user
    Membership.objects.filter(user=user, tenant=context.tenant).delete()
    operator.delete()
    user.delete()
    _audit(
        request,
        action="operator_deleted",
        resource_type="Operator",
        resource_id=resource_id,
        tenant=context.tenant,
        detail={"before": snapshot, "reason": payload.reason.strip()},
    )
    return {"detail": "Operator berhasil dihapus."}
