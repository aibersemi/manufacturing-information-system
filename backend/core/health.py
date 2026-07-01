"""
Health check endpoints untuk Manufacturing Information System.

Tiga level health check:
- /api/health/live   — Liveness probe: aplikasi hidup?
- /api/health/ready  — Readiness probe: aplikasi siap terima traffic?
- /api/health/dependencies — Cek koneksi ke PostgreSQL, Redis, Meilisearch
"""

import logging
from http import HTTPStatus

import redis
from django.conf import settings
from django.db import connection
from django.http import HttpResponse
from meilisearch import Client
from ninja import Router, Schema

from backend.core.observability import collect_queue_depths, render_prometheus_metrics

logger = logging.getLogger(__name__)

router = Router(tags=["Health"])

# Health probe harus mengubah semua kegagalan dependency menjadi status HTTP,
# termasuk error driver yang tidak memiliki base exception lintas-library.
# pylint: disable=broad-exception-caught


class StatusResponse(Schema):
    status: str


class DependencyStatus(Schema):
    name: str
    status: str
    detail: str = ""


class DependenciesResponse(Schema):
    status: str
    dependencies: list[DependencyStatus]


@router.get("/live", response=StatusResponse, summary="Liveness probe")
def health_live(request):
    """Selalu mengembalikan 200 jika proses aplikasi berjalan."""
    return {"status": "ok"}


@router.get("/ready", response=StatusResponse, summary="Readiness probe")
def health_ready(request):
    """Cek apakah Django ORM dan database connection pool siap."""
    try:
        connection.ensure_connection()
        return {"status": "ok"}
    except Exception:
        logger.exception("Readiness check gagal")
        return HTTPStatus.SERVICE_UNAVAILABLE, {"status": "unavailable"}


@router.get(
    "/dependencies",
    response=DependenciesResponse,
    summary="Dependency health check",
)
def health_dependencies(request):
    """Cek koneksi ke semua dependency eksternal."""
    deps: list[DependencyStatus] = []
    all_ok = True

    # 1. PostgreSQL
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        deps.append(DependencyStatus(name="postgresql", status="ok"))
    except Exception as exc:
        all_ok = False
        deps.append(
            DependencyStatus(name="postgresql", status="error", detail=str(exc))
        )

    # 2. Redis DB 0 (Dramatiq broker)
    try:
        r = redis.from_url(settings.REDIS_BROKER_URL, socket_timeout=3)
        r.ping()
        deps.append(DependencyStatus(name="redis_db0_broker", status="ok"))
    except Exception as exc:
        all_ok = False
        deps.append(
            DependencyStatus(name="redis_db0_broker", status="error", detail=str(exc))
        )
    else:
        try:
            queue_depths = collect_queue_depths()
        except Exception as exc:
            all_ok = False
            deps.append(
                DependencyStatus(
                    name="dramatiq_queues", status="error", detail=str(exc)
                )
            )
        else:
            for depth in queue_depths:
                deps.append(
                    DependencyStatus(
                        name=f"dramatiq_queue_{depth.name}",
                        status="ok",
                        detail=f"pending={depth.pending}; delayed={depth.delayed}",
                    )
                )

    # 3. Redis DB 1 (Channels/cache)
    try:
        r = redis.from_url(settings.REDIS_RUNTIME_URL, socket_timeout=3)
        r.ping()
        deps.append(DependencyStatus(name="redis_db1_cache", status="ok"))
    except Exception as exc:
        all_ok = False
        deps.append(
            DependencyStatus(name="redis_db1_cache", status="error", detail=str(exc))
        )

    # 4. Meilisearch
    try:
        client = Client(
            settings.MEILISEARCH_URL.rstrip("/"),
            settings.MEILISEARCH_API_KEY or None,
            timeout=3,
        )
        health = client.health()
        if health.get("status") == "available":
            deps.append(DependencyStatus(name="meilisearch", status="ok"))
        else:
            all_ok = False
            deps.append(
                DependencyStatus(
                    name="meilisearch",
                    status="error",
                    detail=f"status={health.get('status', 'unknown')}",
                )
            )
    except Exception as exc:
        all_ok = False
        deps.append(
            DependencyStatus(name="meilisearch", status="error", detail=str(exc))
        )

    overall_status = "ok" if all_ok else "degraded"
    return {"status": overall_status, "dependencies": deps}


@router.get("/metrics", include_in_schema=False)
def health_metrics(request):
    """Metrik proses dan backlog dalam format Prometheus text."""
    return HttpResponse(
        render_prometheus_metrics(),
        content_type="text/plain; version=0.0.4; charset=utf-8",
    )
