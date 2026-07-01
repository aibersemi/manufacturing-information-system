"""
Custom middleware untuk Manufacturing Information System.
"""

import re
import logging
import time
import uuid

from django.conf import settings
from django.db import connection
from django.db import transaction
from django.http import HttpRequest, HttpResponse

from backend.core.models import AuditEvent, Tenant
from backend.core.observability import record_http_request, record_slow_query
from backend.logging_config import reset_request_context, set_request_context

REQUEST_ID_MAX_LENGTH = 128
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:/=-]+$")
logger = logging.getLogger("backend.observability")


def _dedupe_policy_sources(sources: list[str]) -> list[str]:
    seen = set()
    result = []
    for source in sources:
        if not source or source in seen:
            continue
        seen.add(source)
        result.append(source)
    return result


def build_csp_policy() -> str:
    frontend_url = getattr(settings, "PUBLIC_FRONTEND_URL", "")
    api_ws_url = getattr(settings, "PUBLIC_API_WS_URL", "")
    form_sources = " ".join(_dedupe_policy_sources(["'self'", frontend_url]))
    connect_sources = " ".join(
        _dedupe_policy_sources(["'self'", frontend_url, api_ws_url])
    )
    return "; ".join(
        (
            "default-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'none'",
            f"form-action {form_sources}",
            f"connect-src {connect_sources}",
        )
    )


def normalize_request_id(value: str | None) -> str:
    """
    Normalisasi X-Request-ID dari client/proxy.

    Nilai valid diteruskan agar tracing lintas layer tetap tersambung.
    Nilai kosong, terlalu panjang, atau berisi karakter header yang tidak aman
    diganti UUID baru.
    """
    if not value:
        return str(uuid.uuid4())

    request_id = value.strip()
    if (
        not request_id
        or len(request_id) > REQUEST_ID_MAX_LENGTH
        or not REQUEST_ID_PATTERN.fullmatch(request_id)
    ):
        return str(uuid.uuid4())

    return request_id


class RequestIDMiddleware:
    """
    Middleware yang men-generate atau meneruskan X-Request-ID header
    di setiap request untuk keperluan tracing dan audit forensik.

    Jika client mengirim header X-Request-ID, nilai tersebut digunakan.
    Jika tidak, UUID4 baru di-generate.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request_id = normalize_request_id(request.headers.get("X-Request-ID"))
        # Simpan di request object agar bisa diakses dari view/service layer
        request.request_id = request_id
        context_token = set_request_context(request_id=request_id)

        try:
            response: HttpResponse = self.get_response(request)
            response["X-Request-ID"] = request_id
            return response
        finally:
            reset_request_context(context_token)


class ObservabilityMiddleware:
    """Log request, exception, metrik proses, dan slow query database."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.slow_query_threshold_ms = settings.OBSERVABILITY_SLOW_QUERY_MS

    def __call__(self, request: HttpRequest) -> HttpResponse:
        started_at = time.perf_counter()
        db_query_count = 0
        db_duration_ms = 0.0

        def execute_wrapper(execute, sql, params, many, context):
            nonlocal db_duration_ms, db_query_count
            query_started_at = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                query_duration_ms = (time.perf_counter() - query_started_at) * 1000
                db_query_count += 1
                db_duration_ms += query_duration_ms
                if query_duration_ms >= self.slow_query_threshold_ms:
                    record_slow_query(query_duration_ms)
                    logger.warning(
                        "database_slow_query",
                        extra={
                            "event": "database_slow_query",
                            "method": request.method,
                            "path": request.path,
                            "slow_query_ms": round(query_duration_ms, 3),
                            "sql": _redact_sql(sql),
                        },
                    )

        try:
            with connection.execute_wrapper(execute_wrapper):
                response: HttpResponse = self.get_response(request)
        except Exception:
            duration_ms = (time.perf_counter() - started_at) * 1000
            record_http_request(
                method=request.method,
                path=request.path,
                status_code=500,
                duration_ms=duration_ms,
            )
            logger.exception(
                "request_exception",
                extra={
                    "event": "request_exception",
                    "method": request.method,
                    "path": request.path,
                    "status_code": 500,
                    "duration_ms": round(duration_ms, 3),
                    "db_query_count": db_query_count,
                    "db_duration_ms": round(db_duration_ms, 3),
                    "client_ip": request.META.get("REMOTE_ADDR"),
                },
            )
            raise

        duration_ms = (time.perf_counter() - started_at) * 1000
        record_http_request(
            method=request.method,
            path=request.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )
        logger.info(
            "request_finished",
            extra={
                "event": "request_finished",
                "method": request.method,
                "path": request.path,
                "status_code": response.status_code,
                "duration_ms": round(duration_ms, 3),
                "db_query_count": db_query_count,
                "db_duration_ms": round(db_duration_ms, 3),
                "client_ip": request.META.get("REMOTE_ADDR"),
                "user_id": _user_id(request),
                "tenant_id": _tenant_id(request),
            },
        )
        return response


class ResponseSecurityMiddleware:
    """Header pertahanan tambahan pada origin API; edge tetap menambah kebijakan publik."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        response.setdefault("Content-Security-Policy", build_csp_policy())
        response.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        response.setdefault("Cross-Origin-Resource-Policy", "same-site")
        return response


def _redact_sql(sql: str) -> str:
    """Ringkas SQL tanpa params agar log slow query tidak memuat nilai sensitif."""
    return " ".join(sql.split())[:500]


def _user_id(request: HttpRequest) -> int | None:
    user = getattr(request, "user", None)
    if user and user.is_authenticated:
        return user.pk
    return None


def _tenant_id(request: HttpRequest) -> int | None:
    if hasattr(request, "session"):
        return request.session.get("active_tenant_id")
    return None


class MutationAuditMiddleware:
    """Catat hasil seluruh mutation API; detail domain ditambah oleh service terkait."""

    MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        tenant_id = (
            request.session.get("active_tenant_id")
            if hasattr(request, "session")
            else None
        )
        response = self.get_response(request)
        if (
            request.method not in self.MUTATION_METHODS
            or not request.path.startswith("/api/")
            or request.path.startswith("/api/auth/")
        ):
            return response
        if transaction.get_connection().needs_rollback:
            return response
        tenant = Tenant.objects.filter(id=tenant_id).first() if tenant_id else None
        user = (
            request.user
            if getattr(request, "user", None) and request.user.is_authenticated
            else None
        )
        AuditEvent.objects.create(
            tenant=tenant,
            user=user,
            action="api_mutation",
            resource_type="endpoint",
            resource_id=request.path[:200],
            detail={
                "method": request.method,
                "status_code": response.status_code,
                "result": "success" if response.status_code < 400 else "rejected",
            },
            ip_address=request.META.get("REMOTE_ADDR"),
            request_id=getattr(request, "request_id", ""),
        )
        return response
