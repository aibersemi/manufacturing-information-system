"""
Smoke tests untuk health endpoints dan konfigurasi keamanan.

Verifikasi bahwa baseline backend berfungsi:
- Health endpoints mengembalikan response yang benar
- OpenAPI schema bisa diakses
- Konfigurasi session/CSRF aman (tidak menyimpan auth di browser storage)
"""

import pytest
from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.middleware.csrf import _get_new_csrf_string
from django.test import Client
from django.urls import path
from ninja import NinjaAPI
from ninja.security import django_auth
from ninja.security.session import SessionAuth

from backend.api import api
from backend.core.models import AuditEvent

test_api = NinjaAPI(
    title="Test Protected API",
    version="1.0.0",
    urls_namespace="test-protected-api",
    auth=django_auth,
)


@test_api.get("/protected")
def protected_get(request):
    return {"username": request.auth.username}


@test_api.post("/protected")
def protected_post(request):
    return {"status": "ok"}


urlpatterns = [path("test-api/", test_api.urls)]


@pytest.mark.django_db
class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_liveness_returns_ok(self):
        """Liveness probe harus selalu mengembalikan 200."""
        client = Client()
        response = client.get("/api/health/live")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

    def test_readiness_returns_ok(self):
        """Readiness probe harus mengembalikan 200 jika database siap."""
        client = Client()
        response = client.get("/api/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

    def test_dependencies_returns_structured_response(self):
        """
        Dependency health check harus mengembalikan status per dependency.
        PostgreSQL pasti tersedia di test environment (pytest-django memakainya).
        """
        client = Client()
        response = client.get("/api/health/dependencies")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "dependencies" in data
        assert isinstance(data["dependencies"], list)

        # PostgreSQL harus tersedia karena test database aktif
        pg_dep = next(
            (d for d in data["dependencies"] if d["name"] == "postgresql"),
            None,
        )
        assert pg_dep is not None
        assert pg_dep["status"] == "ok"

    def test_openapi_schema_accessible(self):
        """OpenAPI schema harus bisa diakses di /api/schema."""
        client = Client()
        response = client.get("/api/schema")
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "paths" in data

    def test_metrics_endpoint_returns_prometheus_text(self):
        """Endpoint metrics harus publik dan memakai format Prometheus text."""
        client = Client()
        client.get("/api/health/live")

        response = client.get("/api/health/metrics")

        assert response.status_code == 200
        assert response["Content-Type"].startswith("text/plain")
        text = response.content.decode()
        assert "mis_process_uptime_seconds" in text
        assert "mis_http_requests_total" in text
        assert 'path="/api/health/live"' in text
        assert "mis_dramatiq_queue_scrape_ok" in text


class TestSecurityConfig:
    """Test konfigurasi keamanan session dan cookie."""

    def test_session_cookie_httponly(self, settings):
        """Session cookie harus HttpOnly agar tidak bisa diakses JavaScript."""
        assert settings.SESSION_COOKIE_HTTPONLY is True

    def test_session_cookie_samesite(self, settings):
        """Session cookie harus SameSite=Lax untuk proteksi CSRF dasar."""
        assert settings.SESSION_COOKIE_SAMESITE == "Lax"

    def test_csrf_cookie_samesite(self, settings):
        """CSRF cookie harus SameSite=Lax."""
        assert settings.CSRF_COOKIE_SAMESITE == "Lax"

    def test_auth_user_model_set(self, settings):
        """AUTH_USER_MODEL harus ditetapkan ke custom User model."""
        assert settings.AUTH_USER_MODEL == "core.User"

    def test_session_engine_is_db(self, settings):
        """Session harus disimpan di database, bukan di cookie atau cache."""
        assert settings.SESSION_ENGINE == "django.contrib.sessions.backends.db"

    def test_cors_allows_request_id_header(self, settings):
        """Preflight harus mengizinkan Request ID dari frontend lintas subdomain."""
        assert "x-request-id" in settings.CORS_ALLOW_HEADERS

    def test_api_default_auth_is_session_auth(self):
        """API baru harus memakai session auth secara default."""
        assert len(api.auth) == 1
        assert isinstance(api.auth[0], SessionAuth)

    def test_audit_event_request_id_is_string_field(self):
        """Request ID audit harus kompatibel dengan trace ID non-UUID."""
        field = AuditEvent._meta.get_field("request_id")
        assert field.get_internal_type() == "CharField"
        assert field.max_length == 128

    def test_observability_middleware_enabled(self, settings):
        """Middleware observability harus masuk jalur request utama."""
        assert "backend.middleware.ObservabilityMiddleware" in settings.MIDDLEWARE

    def test_observability_defaults(self, settings):
        """Default observability harus memantau slow query dan queue utama."""
        assert settings.OBSERVABILITY_SLOW_QUERY_MS == 500
        assert settings.OBSERVABILITY_DRAMATIQ_QUEUES == ["default"]


@pytest.mark.django_db
@pytest.mark.urls(__name__)
class TestSessionAuthAndCsrf:
    """Test auth default Django Ninja dan CSRF untuk endpoint protected."""

    def test_protected_endpoint_rejects_anonymous_user(self):
        client = Client(enforce_csrf_checks=True)
        response = client.get("/test-api/protected")
        assert response.status_code == 401

    def test_protected_get_accepts_logged_in_user(self):
        user = get_user_model().objects.create_user(
            username="operator", password="secret-pass"
        )
        client = Client(enforce_csrf_checks=True)
        assert client.login(username=user.username, password="secret-pass")

        response = client.get("/test-api/protected")

        assert response.status_code == 200
        assert response.json()["username"] == user.username

    def test_protected_post_rejects_missing_csrf_token(self):
        user = get_user_model().objects.create_user(
            username="finance", password="secret-pass"
        )
        client = Client(enforce_csrf_checks=True)
        assert client.login(username=user.username, password="secret-pass")

        response = client.post("/test-api/protected", data={})

        assert response.status_code == 403

    def test_protected_post_accepts_valid_csrf_token(self):
        user = get_user_model().objects.create_user(
            username="kepala", password="secret-pass"
        )
        csrf_token = _get_new_csrf_string()
        client = Client(enforce_csrf_checks=True)
        assert client.login(username=user.username, password="secret-pass")
        client.cookies[django_settings.CSRF_COOKIE_NAME] = csrf_token

        response = client.post(
            "/test-api/protected",
            data={},
            headers={"X-CSRFToken": csrf_token},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestRequestIDMiddleware:
    """Test Request ID middleware."""

    def test_response_has_request_id_header(self):
        """Setiap response harus mengandung header X-Request-ID."""
        client = Client()
        response = client.get("/api/health/live")
        assert "X-Request-ID" in response

    def test_custom_request_id_propagated(self):
        """Jika client mengirim X-Request-ID, nilai tersebut harus diteruskan."""
        client = Client()
        custom_id = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        response = client.get(
            "/api/health/live",
            headers={"X-Request-ID": custom_id},
        )
        assert response["X-Request-ID"] == custom_id

    def test_unsafe_request_id_is_replaced(self):
        """Request ID terlalu panjang tidak boleh dipantulkan ke response."""
        client = Client()
        unsafe_id = "a" * 129
        response = client.get(
            "/api/health/live",
            headers={"X-Request-ID": unsafe_id},
        )
        assert response["X-Request-ID"] != unsafe_id
        assert len(response["X-Request-ID"]) <= 128


class TestDramatiqConfig:
    """Test konfigurasi broker Dramatiq."""

    def test_dramatiq_uses_redis_db0(self):
        """Worker harus memakai Redis DB 0 dari settings."""
        import dramatiq  # pylint: disable=import-outside-toplevel

        from backend.core import (  # pylint: disable=import-outside-toplevel
            tasks as _tasks,  # noqa: F401
        )

        broker = dramatiq.get_broker()
        db_index = broker.client.connection_pool.connection_kwargs["db"]
        assert db_index == 0
