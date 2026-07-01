"""
Tests untuk auth endpoints — Manufacturing Information System.

Mencakup:
- Login berhasil dengan kredensial valid
- Login gagal: password salah, user tidak aktif, membership tidak aktif, tenant tidak aktif
- Pesan error generik (TEN-003: tidak membocorkan info mana yang salah)
- Rate limiting login
- Endpoint /api/auth/me dengan dan tanpa session
- Endpoint /api/auth/tenants mengembalikan hanya tenant aktif
- Audit event tercatat untuk login berhasil dan gagal
- CSRF token diperlukan untuk POST
- Logout invalidasi session
"""

# Fixture pytest sengaja diinjeksikan melalui nama argumen test.
# pylint: disable=redefined-outer-name,unused-argument

import pytest
from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.middleware.csrf import _get_new_csrf_string
from django.test import Client

from backend.core.models import AuditEvent, Membership, Tenant

User = get_user_model()

# Pesan error generik yang harus selalu dikembalikan
GENERIC_ERROR = "Kombinasi konveksi, nama pengguna, atau kata sandi tidak valid."


@pytest.fixture(autouse=True)
def _clear_rate_limit_cache():
    """Clear rate limit cache sebelum setiap test agar tidak saling mengganggu."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture()
def tenant_a(db):
    """Tenant aktif untuk testing."""
    return Tenant.objects.create(
        name="Konveksi Alpha",
        slug="alpha",
        is_active=True,
    )


@pytest.fixture()
def tenant_b(db):
    """Tenant aktif kedua untuk testing lintas-tenant."""
    return Tenant.objects.create(
        name="Konveksi Beta",
        slug="beta",
        is_active=True,
    )


@pytest.fixture()
def tenant_inactive(db):
    """Tenant tidak aktif."""
    return Tenant.objects.create(
        name="Konveksi Inactive",
        slug="inactive",
        is_active=False,
    )


@pytest.fixture()
def user_active(db):
    """User aktif dengan password yang diketahui."""
    return User.objects.create_user(
        username="operator1",
        password="SecurePassword123!",
        first_name="Budi",
        last_name="Santoso",
    )


@pytest.fixture()
def user_superadmin(db):
    """Superuser server-side dengan password yang diketahui."""
    return User.objects.create_user(
        username="superadmin",
        password="SecurePassword123!",
        is_staff=True,
        is_superuser=True,
    )


@pytest.fixture()
def user_inactive(db):
    """User tidak aktif."""
    return User.objects.create_user(
        username="deactivated",
        password="SecurePassword123!",
        is_active=False,
    )


@pytest.fixture()
def membership_active(tenant_a, user_active):
    """Membership aktif antara user_active dan tenant_a."""
    return Membership.objects.create(
        user=user_active,
        tenant=tenant_a,
        role=Membership.Role.OPERATOR,
        is_active=True,
    )


@pytest.fixture()
def membership_inactive(tenant_a, user_active):
    """Membership tidak aktif."""
    return Membership.objects.create(
        user=user_active,
        tenant=tenant_a,
        role=Membership.Role.OPERATOR,
        is_active=False,
    )


def _login_payload(
    tenant_slug="alpha", username="operator1", password="SecurePassword123!"
):
    """Helper: buat payload login JSON."""
    return {
        "tenant_slug": tenant_slug,
        "username": username,
        "password": password,
    }


def _post_login(client, payload=None, with_csrf=True):
    """Helper: kirim POST /api/auth/login dengan CSRF token."""
    if payload is None:
        payload = _login_payload()
    kwargs = {
        "data": payload,
        "content_type": "application/json",
    }
    if with_csrf:
        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token
        kwargs["headers"] = {"X-CSRFToken": csrf_token}
    return client.post("/api/auth/login", **kwargs)


@pytest.mark.django_db
class TestLoginSuccess:
    """Login berhasil dengan kredensial dan membership valid."""

    def test_login_returns_session_data(self, tenant_a, user_active, membership_active):
        """Login berhasil harus mengembalikan data user, tenant, dan role."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload())
        assert response.status_code == 200

        data = response.json()
        assert data["user"]["username"] == "operator1"
        assert data["user"]["full_name"] == "Budi Santoso"
        assert data["tenant"]["slug"] == "alpha"
        assert data["role"] == "operator"

    def test_login_creates_session(self, tenant_a, user_active, membership_active):
        """Login berhasil harus membuat session cookie."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload())
        assert response.status_code == 200
        assert django_settings.SESSION_COOKIE_NAME in response.cookies

    def test_login_sets_active_tenant_in_session(
        self, tenant_a, user_active, membership_active
    ):
        """Session harus memiliki active_tenant_id setelah login."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())

        # Cek session via /api/auth/me
        me_response = client.get("/api/auth/me")
        assert me_response.status_code == 200
        assert me_response.json()["tenant"]["id"] == tenant_a.id

    def test_login_records_success_audit_event(
        self, tenant_a, user_active, membership_active
    ):
        """Audit event harus dicatat untuk login berhasil."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())

        event = AuditEvent.objects.filter(action="login_success").first()
        assert event is not None
        assert event.user_id == user_active.id
        assert event.tenant_id == tenant_a.id

    def test_superuser_login_ke_tenant_tanpa_membership(
        self, tenant_a, user_superadmin
    ):
        """Superuser server-side berperan super_admin di tenant aktif mana pun."""
        client = Client(enforce_csrf_checks=True)

        response = _post_login(
            client,
            _login_payload(username="superadmin", tenant_slug="alpha"),
        )

        assert response.status_code == 200
        data = response.json()
        assert data["tenant"]["id"] == tenant_a.id
        assert data["role"] == Membership.Role.SUPER_ADMIN
        assert client.session["active_tenant_id"] == tenant_a.id
        assert not Membership.objects.filter(
            user=user_superadmin,
            tenant=tenant_a,
        ).exists()


@pytest.mark.django_db
class TestLoginFailure:
    """Login gagal — semua harus mengembalikan pesan error generik."""

    def test_wrong_password(self, tenant_a, user_active, membership_active):
        """Password salah harus mengembalikan 401 dengan pesan generik."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload(password="wrong"))
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_nonexistent_user(self, tenant_a):
        """User tidak ada harus mengembalikan 401 dengan pesan generik."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload(username="nobody"))
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_inactive_user(self, tenant_a, user_inactive):
        """User tidak aktif harus mengembalikan 401 dengan pesan generik."""
        Membership.objects.create(
            user=user_inactive, tenant=tenant_a, role=Membership.Role.OPERATOR
        )
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload(username="deactivated"))
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_nonexistent_tenant(self, user_active):
        """Tenant tidak ada harus mengembalikan 401 dengan pesan generik."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload(tenant_slug="nonexistent"))
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_inactive_tenant(self, tenant_inactive, user_active):
        """Tenant tidak aktif harus mengembalikan 401 dengan pesan generik."""
        Membership.objects.create(
            user=user_active, tenant=tenant_inactive, role=Membership.Role.OPERATOR
        )
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload(tenant_slug="inactive"))
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_superuser_tetap_ditolak_untuk_tenant_nonaktif(
        self, tenant_inactive, user_superadmin
    ):
        """Hak superuser tidak membuka tenant yang sudah dinonaktifkan."""
        client = Client(enforce_csrf_checks=True)

        response = _post_login(
            client,
            _login_payload(username="superadmin", tenant_slug="inactive"),
        )

        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_no_membership(self, tenant_a, user_active):
        """User tanpa membership di tenant harus mengembalikan 401."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload())
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_inactive_membership(self, tenant_a, user_active, membership_inactive):
        """Membership tidak aktif harus mengembalikan 401."""
        client = Client(enforce_csrf_checks=True)
        response = _post_login(client, _login_payload())
        assert response.status_code == 401
        assert response.json()["detail"] == GENERIC_ERROR

    def test_login_failure_records_audit_event(self, tenant_a, user_active):
        """Audit event harus dicatat untuk login gagal."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload(password="wrong"))

        event = AuditEvent.objects.filter(action="login_failed").first()
        assert event is not None


@pytest.mark.django_db
class TestLoginRateLimit:
    """Rate limiting mencegah brute force."""

    def test_rate_limit_after_max_attempts(
        self, tenant_a, user_active, membership_active
    ):
        """Setelah 5 percobaan gagal, harus mengembalikan 429."""
        client = Client(enforce_csrf_checks=True)
        for _ in range(5):
            _post_login(client, _login_payload(password="wrong"))

        # Percobaan ke-6 harus di-rate-limit
        response = _post_login(client, _login_payload())
        assert response.status_code == 429

    def test_rate_limit_records_audit_event(
        self, tenant_a, user_active, membership_active
    ):
        """Rate limited harus dicatat di audit."""
        client = Client(enforce_csrf_checks=True)
        for _ in range(5):
            _post_login(client, _login_payload(password="wrong"))

        _post_login(client, _login_payload())
        event = AuditEvent.objects.filter(action="login_rate_limited").first()
        assert event is not None


@pytest.mark.django_db
class TestCsrfProtection:
    """CSRF protection untuk seluruh endpoint POST autentikasi."""

    def test_login_rejects_missing_csrf_token(
        self, tenant_a, user_active, membership_active
    ):
        """POST /api/auth/login tanpa CSRF token harus ditolak."""
        client = Client(enforce_csrf_checks=True)

        response = _post_login(client, _login_payload(), with_csrf=False)

        assert response.status_code == 403

    def test_logout_rejects_missing_csrf_token(
        self, tenant_a, user_active, membership_active
    ):
        """POST /api/auth/logout tanpa CSRF token harus ditolak."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())

        # Coba logout tanpa CSRF
        response = client.post(
            "/api/auth/logout",
            content_type="application/json",
        )
        assert response.status_code == 403


@pytest.mark.django_db
class TestAuthMe:
    """Endpoint GET /api/auth/me."""

    def test_me_returns_401_when_not_logged_in(self):
        """Harus mengembalikan 401 jika belum login."""
        client = Client()
        response = client.get("/api/auth/me")
        assert response.status_code == 401

    def test_me_returns_session_data(self, tenant_a, user_active, membership_active):
        """Harus mengembalikan data user dan tenant jika sudah login."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())

        response = client.get("/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["user"]["username"] == "operator1"
        assert data["tenant"]["slug"] == "alpha"
        assert data["role"] == "operator"

    def test_me_returns_superuser_effective_role(self, tenant_a, user_superadmin):
        """Session superuser tanpa membership tetap tervalidasi sebagai super_admin."""
        client = Client(enforce_csrf_checks=True)
        _post_login(
            client,
            _login_payload(username="superadmin", tenant_slug="alpha"),
        )

        response = client.get("/api/auth/me")

        assert response.status_code == 200
        data = response.json()
        assert data["user"]["username"] == "superadmin"
        assert data["tenant"]["slug"] == "alpha"
        assert data["role"] == Membership.Role.SUPER_ADMIN


@pytest.mark.django_db
class TestLogout:
    """Endpoint POST /api/auth/logout."""

    def test_logout_invalidates_session(self, tenant_a, user_active, membership_active):
        """Setelah logout, /api/auth/me harus mengembalikan 401."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())

        # Logout
        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token
        response = client.post(
            "/api/auth/logout",
            content_type="application/json",
            headers={"X-CSRFToken": csrf_token},
        )
        assert response.status_code == 200

        # Session harus invalid
        me_response = client.get("/api/auth/me")
        assert me_response.status_code == 401

    def test_logout_records_audit_event(self, tenant_a, user_active, membership_active):
        """Audit event harus dicatat untuk logout."""
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())

        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token
        client.post(
            "/api/auth/logout",
            content_type="application/json",
            headers={"X-CSRFToken": csrf_token},
        )

        event = AuditEvent.objects.filter(action="logout").first()
        assert event is not None


@pytest.mark.django_db
class TestChangePassword:
    def test_semua_user_dapat_mengganti_password_sendiri(
        self, tenant_a, user_active, membership_active
    ):
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())
        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token
        response = client.post(
            "/api/auth/change-password",
            {
                "current_password": "SecurePassword123!",
                "new_password": "PasswordBaru123!",
                "new_password_confirmation": "PasswordBaru123!",
            },
            content_type="application/json",
            headers={"X-CSRFToken": csrf_token},
        )
        assert response.status_code == 200
        user_active.refresh_from_db()
        assert user_active.check_password("PasswordBaru123!")
        assert client.get("/api/auth/me").status_code == 200

    def test_password_lama_wajib_valid(self, tenant_a, user_active, membership_active):
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())
        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token
        response = client.post(
            "/api/auth/change-password",
            {
                "current_password": "salah",
                "new_password": "PasswordBaru123!",
                "new_password_confirmation": "PasswordBaru123!",
            },
            content_type="application/json",
            headers={"X-CSRFToken": csrf_token},
        )
        assert response.status_code == 400

    def test_verifikasi_password_dibatasi_lima_percobaan(
        self, tenant_a, user_active, membership_active
    ):
        client = Client(enforce_csrf_checks=True)
        _post_login(client, _login_payload())
        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token
        statuses = []
        for _ in range(6):
            response = client.post(
                "/api/auth/change-password",
                {
                    "current_password": "salah",
                    "new_password": "PasswordBaru123!",
                    "new_password_confirmation": "PasswordBaru123!",
                },
                content_type="application/json",
                headers={"X-CSRFToken": csrf_token},
            )
            statuses.append(response.status_code)

        assert statuses == [400, 400, 400, 400, 400, 429]
        assert AuditEvent.objects.filter(
            action="password_verification_rate_limited"
        ).exists()


@pytest.mark.django_db
class TestTenantsEndpoint:
    """Endpoint GET /api/auth/tenants."""

    def test_returns_active_tenants_only(self, tenant_a, tenant_inactive):
        """Harus mengembalikan hanya tenant aktif."""
        client = Client()
        response = client.get("/api/auth/tenants")
        assert response.status_code == 200

        data = response.json()
        slugs = [t["slug"] for t in data]
        assert "alpha" in slugs
        assert "inactive" not in slugs

    def test_returns_only_slug_and_name(self, tenant_a):
        """Harus mengembalikan hanya slug dan name, tanpa informasi sensitif."""
        client = Client()
        response = client.get("/api/auth/tenants")
        data = response.json()

        for tenant in data:
            assert set(tenant.keys()) == {"slug", "name"}

    def test_no_auth_required(self, tenant_a):
        """Endpoint tenants harus bisa diakses tanpa autentikasi."""
        client = Client()
        response = client.get("/api/auth/tenants")
        assert response.status_code == 200

    def test_sets_csrf_cookie(self, tenant_a):
        """Endpoint publik menerbitkan cookie CSRF untuk mutation login."""
        client = Client(enforce_csrf_checks=True)

        response = client.get("/api/auth/tenants")

        assert django_settings.CSRF_COOKIE_NAME in response.cookies


@pytest.mark.django_db
class TestSuperuserTenantAccess:
    """Akses lintas-tenant untuk superuser server-side."""

    def test_available_tenants_superuser_mengembalikan_semua_tenant_aktif(
        self, tenant_a, tenant_b, tenant_inactive, user_superadmin
    ):
        client = Client(enforce_csrf_checks=True)
        _post_login(
            client,
            _login_payload(username="superadmin", tenant_slug="alpha"),
        )

        response = client.get("/api/auth/available-tenants")

        assert response.status_code == 200
        slugs = {item["slug"] for item in response.json()}
        assert slugs == {"alpha", "beta"}

    def test_superuser_dapat_switch_ke_tenant_tanpa_membership(
        self, tenant_a, tenant_b, user_superadmin
    ):
        client = Client(enforce_csrf_checks=True)
        _post_login(
            client,
            _login_payload(username="superadmin", tenant_slug="alpha"),
        )
        csrf_token = _get_new_csrf_string()
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token

        response = client.post(
            "/api/auth/switch-tenant",
            {"tenant_slug": "beta"},
            content_type="application/json",
            headers={"X-CSRFToken": csrf_token},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["tenant"]["id"] == tenant_b.id
        assert data["role"] == Membership.Role.SUPER_ADMIN
        assert client.session["active_tenant_id"] == tenant_b.id
