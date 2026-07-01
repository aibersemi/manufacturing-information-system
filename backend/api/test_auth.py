import pytest
from django.test import Client

from backend.core.models import Membership, Tenant, User


@pytest.mark.django_db
def test_login_and_tenant_isolation():
    client = Client()

    # Buat tenant
    tenant_a = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    Tenant.objects.create(name="Konveksi B", slug="konveksi-b")

    # Buat user
    user = User.objects.create_user(username="testuser", password="testpassword")

    # Berikan akses HANYA ke Konveksi A
    Membership.objects.create(user=user, tenant=tenant_a, role="operator")

    # Test 1: Gagal login ke Konveksi B (Tidak ada akses)
    response = client.post(
        "/api/auth/login",
        {
            "username": "testuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-b",
        },
        content_type="application/json",
    )
    assert response.status_code == 401

    # Test 2: Berhasil login ke Konveksi A
    response = client.post(
        "/api/auth/login",
        {
            "username": "testuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    assert client.session["active_tenant_id"] == tenant_a.id

    # Test 3: Cek endpoint /api/auth/me memvalidasi session
    response = client.get("/api/auth/me")
    assert response.status_code == 200
    data = response.json()
    assert data["active_tenant_id"] == tenant_a.id
    assert data["username"] == "testuser"
