import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from backend.core.models import Membership, Tenant

User = get_user_model()


@pytest.mark.django_db
def test_ensure_superadmin_creates_user_tenant_and_membership(monkeypatch):
    monkeypatch.setenv("SUPER_ADMIN_USERNAME", "superadmin")
    monkeypatch.setenv("SUPER_ADMIN_PASSWORD", "SecurePassword123!")

    call_command("ensure_superadmin", tenant_slug="mis", tenant_name="MIS")

    user = User.objects.get(username="superadmin")
    tenant = Tenant.objects.get(slug="mis")
    membership = Membership.objects.get(user=user, tenant=tenant)

    assert user.is_active is True
    assert user.is_staff is True
    assert user.is_superuser is True
    assert user.check_password("SecurePassword123!") is True
    assert tenant.name == "MIS"
    assert tenant.is_active is True
    assert membership.role == Membership.Role.SUPER_ADMIN
    assert membership.is_active is True


@pytest.mark.django_db
def test_ensure_superadmin_updates_existing_records(monkeypatch):
    monkeypatch.setenv("SUPER_ADMIN_USERNAME", "superadmin")
    monkeypatch.setenv("SUPER_ADMIN_PASSWORD", "NewSecurePassword123!")
    user = User.objects.create_user(
        username="superadmin",
        password="OldSecurePassword123!",
        is_active=False,
        is_staff=False,
        is_superuser=False,
    )
    tenant = Tenant.objects.create(slug="mis", name="Old Name", is_active=False)
    Membership.objects.create(
        user=user,
        tenant=tenant,
        role=Membership.Role.OPERATOR,
        is_active=False,
    )

    call_command("ensure_superadmin", tenant_slug="mis", tenant_name="MIS")

    user.refresh_from_db()
    tenant.refresh_from_db()
    membership = Membership.objects.get(user=user, tenant=tenant)

    assert user.is_active is True
    assert user.is_staff is True
    assert user.is_superuser is True
    assert user.check_password("NewSecurePassword123!") is True
    assert tenant.name == "MIS"
    assert tenant.is_active is True
    assert membership.role == Membership.Role.SUPER_ADMIN
    assert membership.is_active is True


@pytest.mark.django_db
def test_ensure_superadmin_requires_env(monkeypatch):
    monkeypatch.delenv("SUPER_ADMIN_USERNAME", raising=False)
    monkeypatch.setenv("SUPER_ADMIN_PASSWORD", "SecurePassword123!")

    with pytest.raises(CommandError, match="SUPER_ADMIN_USERNAME wajib diisi"):
        call_command("ensure_superadmin")
