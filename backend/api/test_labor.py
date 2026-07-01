import pytest
from django.test import Client

from backend.core.models import Membership, Tenant, User
from backend.labor.models import Attendance
from backend.masterdata.models import Operator


@pytest.mark.django_db
def test_labor_attendance():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi L", slug="konveksi-l")
    user = User.objects.create_user(username="laboruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )

    # Login
    client.post(
        "/api/auth/login",
        {
            "username": "laboruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-l",
        },
        content_type="application/json",
    )

    # Buat operator
    operator_user = User.objects.create_user(
        username="operator-labor", password="testpassword"
    )
    op = Operator.objects.create(
        tenant_id=tenant.id,
        user=operator_user,
        name="Budi",
        operator_type=Operator.OperatorType.PENJAHIT,
        status=Operator.OperatorStatus.INTERNAL,
    )

    # Rekam absensi
    response = client.post(
        "/api/labor/attendance",
        data={
            "operator_id": str(op.id),
            "date": "2026-06-21",
            "is_present": True,
            "notes": "Tepat waktu",
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    assert Attendance.objects.filter(tenant_id=tenant.id, operator=op).count() == 1


@pytest.mark.django_db
def test_labor_cash_advance():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi L", slug="konveksi-l")
    user = User.objects.create_user(username="laboruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    client.post(
        "/api/auth/login",
        {
            "username": "laboruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-l",
        },
        content_type="application/json",
    )

    operator_user = User.objects.create_user(
        username="operator-kasbon", password="testpassword"
    )
    op = Operator.objects.create(
        tenant_id=tenant.id,
        user=operator_user,
        name="Budi",
        operator_type=Operator.OperatorType.PENJAHIT,
        status=Operator.OperatorStatus.INTERNAL,
    )
    resp1 = client.post(
        "/api/labor/cash-advance",
        data={
            "operator_id": str(op.id),
            "date": "2026-06-21",
            "amount": "500000.00",
            "notes": "Kasbon mingguan",
        },
        content_type="application/json",
    )
    assert resp1.status_code == 200
    list_resp = client.get("/api/labor/cash-advances")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1
