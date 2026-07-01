"""Regression test API administrasi dan batas RBAC."""

import pytest
from django.test import Client

from backend.core.models import AuditEvent, Membership, Tenant, User
from backend.masterdata.models import Operator


@pytest.fixture()
def administration_setup(db):
    tenant_a = Tenant.objects.create(name="Konveksi A", slug="konveksi-a", code="A")
    tenant_b = Tenant.objects.create(name="Konveksi B", slug="konveksi-b", code="B")
    super_admin = User.objects.create_user(
        "admin", password="AdminSecure123!", is_staff=True, is_superuser=True
    )
    kepala = User.objects.create_user("kepala", password="KepalaSecure123!")
    finance = User.objects.create_user("finance", password="FinanceSecure123!")
    Membership.objects.create(
        user=super_admin, tenant=tenant_a, role=Membership.Role.SUPER_ADMIN
    )
    Membership.objects.create(
        user=super_admin, tenant=tenant_b, role=Membership.Role.SUPER_ADMIN
    )
    Membership.objects.create(
        user=kepala, tenant=tenant_a, role=Membership.Role.KEPALA_KONVEKSI
    )
    Membership.objects.create(
        user=finance, tenant=tenant_a, role=Membership.Role.FINANCE
    )
    return tenant_a, tenant_b, super_admin, kepala, finance


def _login(client, username, password, tenant_slug="konveksi-a"):
    response = client.post(
        "/api/auth/login",
        {
            "username": username,
            "password": password,
            "tenant_slug": tenant_slug,
        },
        content_type="application/json",
    )
    assert response.status_code == 200


@pytest.mark.django_db
def test_hanya_super_admin_dapat_mengelola_tenant(administration_setup):
    client = Client()
    _login(client, "kepala", "KepalaSecure123!")
    assert client.get("/api/administration/tenants").status_code == 403

    client = Client()
    _login(client, "admin", "AdminSecure123!")
    response = client.get("/api/administration/tenants")
    assert response.status_code == 200
    assert response.json()["total"] == 2


@pytest.mark.django_db
def test_super_admin_membuat_finance_multi_tenant(administration_setup):
    tenant_a, tenant_b, *_rest = administration_setup
    client = Client()
    _login(client, "admin", "AdminSecure123!")
    response = client.post(
        "/api/administration/users",
        {
            "username": "finance-baru",
            "first_name": "Finance",
            "last_name": "Baru",
            "email": "finance@example.com",
            "password": "T!9qL2vN7xP4",
            "password_confirmation": "T!9qL2vN7xP4",
            "role": "finance",
            "tenant_ids": [tenant_a.id, tenant_b.id],
        },
        content_type="application/json",
    )
    assert response.status_code == 201
    assert len(response.json()["memberships"]) == 2


@pytest.mark.django_db
def test_kepala_konveksi_ditolak_pada_multi_tenant(administration_setup):
    tenant_a, tenant_b, *_rest = administration_setup
    client = Client()
    _login(client, "admin", "AdminSecure123!")
    response = client.post(
        "/api/administration/users",
        {
            "username": "kepala-baru",
            "first_name": "Kepala",
            "last_name": "Baru",
            "email": "",
            "password": "T!8qL2vN7xP5",
            "password_confirmation": "T!8qL2vN7xP5",
            "role": "kepala_konveksi",
            "tenant_ids": [tenant_a.id, tenant_b.id],
        },
        content_type="application/json",
    )
    assert response.status_code == 422


@pytest.mark.django_db
def test_kepala_membuat_operator_secara_atomik(administration_setup):
    tenant_a, *_rest = administration_setup
    client = Client()
    _login(client, "kepala", "KepalaSecure123!")
    response = client.post(
        "/api/administration/operators",
        {
            "username": "operator-baru",
            "first_name": "Operator",
            "last_name": "Baru",
            "email": "",
            "password": "T!7qL2vN8xP6",
            "password_confirmation": "T!7qL2vN8xP6",
            "operator_type": "penjahit",
            "status": "internal",
            "supervisor_id": None,
            "location": "Lantai 1",
            "phone": "08123456789",
            "account_is_active": True,
            "work_is_active": True,
        },
        content_type="application/json",
    )
    assert response.status_code == 201
    user = User.objects.get(username="operator-baru")
    assert Membership.objects.filter(
        user=user, tenant=tenant_a, role=Membership.Role.OPERATOR
    ).exists()
    assert Operator.objects.filter(user=user, tenant=tenant_a).exists()
    assert AuditEvent.objects.filter(action="operator_created").exists()


@pytest.mark.django_db
def test_reset_password_operator_hanya_super_admin(administration_setup):
    tenant_a, _tenant_b, super_admin, kepala, _finance = administration_setup
    operator_user = User.objects.create_user(
        "operator-reset", password="OperatorLama123!"
    )
    Membership.objects.create(
        user=operator_user, tenant=tenant_a, role=Membership.Role.OPERATOR
    )
    operator = Operator.objects.create(
        tenant=tenant_a,
        user=operator_user,
        name="Operator Reset",
        operator_type=Operator.OperatorType.PENJAHIT,
        status=Operator.OperatorStatus.INTERNAL,
    )
    payload = {
        "new_password": "T!6qL2vN8xP7",
        "new_password_confirmation": "T!6qL2vN8xP7",
        "actor_password": "KepalaSecure123!",
    }

    client = Client()
    _login(client, kepala.username, "KepalaSecure123!")
    response = client.post(
        f"/api/administration/operators/{operator.id}/reset-password",
        payload,
        content_type="application/json",
    )
    assert response.status_code == 403

    client = Client()
    _login(client, super_admin.username, "AdminSecure123!")
    payload["actor_password"] = "AdminSecure123!"
    response = client.post(
        f"/api/administration/operators/{operator.id}/reset-password",
        payload,
        content_type="application/json",
    )
    assert response.status_code == 200
    operator_user.refresh_from_db()
    assert operator_user.check_password("T!6qL2vN8xP7")


@pytest.mark.django_db
def test_akun_tidak_dapat_menonaktifkan_diri(administration_setup):
    _tenant_a, _tenant_b, super_admin, *_rest = administration_setup
    client = Client()
    _login(client, super_admin.username, "AdminSecure123!")
    response = client.post(
        f"/api/administration/users/{super_admin.id}/deactivate",
        {"reason": "Uji penonaktifan"},
        content_type="application/json",
    )
    assert response.status_code in {403, 409}
