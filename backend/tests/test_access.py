"""Regression test untuk tenant session dan RBAC lintas endpoint bisnis."""

# Fixture pytest sengaja diinjeksikan melalui nama argumen test.
# pylint: disable=redefined-outer-name,unused-argument

import pytest
from django.contrib.auth import get_user_model
from django.test import Client, RequestFactory
from ninja.errors import HttpError

from backend.core.access import ROLES_FINANCE, get_tenant_context
from backend.core.models import AuditEvent, Membership, Tenant


@pytest.fixture()
def access_setup(db):
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = get_user_model().objects.create_user("finance-a", password="rahasia")
    membership = Membership.objects.create(
        tenant=tenant,
        user=user,
        role=Membership.Role.FINANCE,
    )
    return tenant, user, membership


def _request(user, tenant_id):
    class SessionStub(dict):
        def flush(self):
            self.clear()

    request = RequestFactory().get("/api/accounting/journals")
    request.user = user
    request.session = SessionStub(active_tenant_id=tenant_id)
    request.request_id = "test-request-id"
    return request


@pytest.mark.django_db
def test_context_memvalidasi_ulang_membership(access_setup):
    tenant, user, membership = access_setup
    request = _request(user, tenant.pk)

    context = get_tenant_context(request, allowed_roles=ROLES_FINANCE)

    assert context.tenant == tenant
    assert context.membership == membership


@pytest.mark.django_db
def test_context_superuser_menggunakan_role_super_admin_tanpa_membership():
    tenant = Tenant.objects.create(name="Konveksi Bebas", slug="konveksi-bebas")
    user = get_user_model().objects.create_user(
        "server-admin",
        password="rahasia",
        is_staff=True,
        is_superuser=True,
    )
    request = _request(user, tenant.pk)

    context = get_tenant_context(
        request,
        allowed_roles={Membership.Role.SUPER_ADMIN},
    )

    assert context.tenant == tenant
    assert context.role == Membership.Role.SUPER_ADMIN
    assert context.membership.pk is None


@pytest.mark.django_db
def test_context_menolak_membership_yang_dinonaktifkan(access_setup):
    tenant, user, membership = access_setup
    membership.is_active = False
    membership.save(update_fields=["is_active"])
    request = _request(user, tenant.pk)

    with pytest.raises(HttpError) as error:
        get_tenant_context(request)

    assert error.value.status_code == 401
    assert AuditEvent.objects.filter(action="access_denied", tenant=tenant).exists()


@pytest.mark.django_db
def test_context_menolak_role_di_luar_kewenangan(access_setup):
    tenant, user, _membership = access_setup
    request = _request(user, tenant.pk)

    with pytest.raises(HttpError) as error:
        get_tenant_context(request, allowed_roles={Membership.Role.KEPALA_KONVEKSI})

    assert error.value.status_code == 403
    event = AuditEvent.objects.get(action="access_denied", tenant=tenant)
    assert event.detail["reason"] == "role_tidak_diizinkan"


@pytest.mark.django_db
def test_endpoint_mutasi_masterdata_menolak_finance(access_setup):
    tenant, user, _membership = access_setup
    client = Client()
    client.force_login(user)
    session = client.session
    session["active_tenant_id"] = tenant.pk
    session.save()

    response = client.post(
        "/api/masterdata/customers",
        data={"name": "Tidak Boleh Dibuat"},
        content_type="application/json",
    )

    assert response.status_code == 403
    assert not tenant.customer_set.exists()
