"""Utilitas observability runtime MIS tanpa layanan eksternal tambahan."""

from __future__ import annotations

import re
import threading
import time
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

from django.conf import settings
from django.db import connection
from dramatiq.common import dq_name


STARTED_AT = time.time()
PATH_ID_PATTERN = re.compile(
    r"/(?:[0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?=/|$)"
)

_metrics_lock = threading.Lock()
_request_total: Counter[tuple[str, str, str]] = Counter()
_request_duration_ms_sum: Counter[tuple[str, str, str]] = Counter()
_slow_query_total = 0
_slow_query_duration_ms_sum = 0.0


@dataclass(frozen=True)
class QueueDepth:
    """Snapshot panjang antrean Dramatiq pada satu queue."""

    name: str
    pending: int
    delayed: int


def normalize_metric_path(path: str) -> str:
    """Kurangi kardinalitas label metrik dengan mengganti ID dinamis."""
    return PATH_ID_PATTERN.sub("/<id>", path)


def record_http_request(
    *,
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
) -> None:
    """Catat metrik HTTP proses lokal untuk endpoint metrics."""
    status_class = f"{status_code // 100}xx"
    key = (method.upper(), normalize_metric_path(path), status_class)
    with _metrics_lock:
        _request_total[key] += 1
        _request_duration_ms_sum[key] += duration_ms


def record_slow_query(duration_ms: float) -> None:
    """Catat jumlah slow query proses lokal."""
    global _slow_query_duration_ms_sum, _slow_query_total
    with _metrics_lock:
        _slow_query_total += 1
        _slow_query_duration_ms_sum += duration_ms


def queue_names() -> list[str]:
    """Daftar queue Dramatiq yang dipantau."""
    return list(settings.OBSERVABILITY_DRAMATIQ_QUEUES)


def collect_queue_depths() -> list[QueueDepth]:
    """Ambil panjang queue dan delayed queue Dramatiq dari Redis broker."""
    from backend.dramatiq_config import configure_broker

    broker = configure_broker()
    depths: list[QueueDepth] = []
    for queue_name in queue_names():
        pending = int(broker.do_qsize(queue_name) or 0)
        delayed = int(broker.do_qsize(dq_name(queue_name)) or 0)
        depths.append(QueueDepth(name=queue_name, pending=pending, delayed=delayed))
    return depths


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _labels(**labels: str) -> str:
    if not labels:
        return ""
    rendered = ",".join(
        f'{name}="{_escape_label(value)}"' for name, value in sorted(labels.items())
    )
    return f"{{{rendered}}}"


def _metric_line(name: str, value: int | float, **labels: str) -> str:
    return f"{name}{_labels(**labels)} {value}"


def _domain_backlog_metrics() -> Iterable[str]:
    from backend.core.models import ExportJob, Notification, OutboxEvent

    yield _metric_line(
        "mis_outbox_unprocessed_total",
        OutboxEvent.objects.filter(is_processed=False).count(),
    )
    yield _metric_line(
        "mis_outbox_retry_pending_total",
        OutboxEvent.objects.filter(is_processed=False, retry_count__gt=0).count(),
    )
    for status in (
        ExportJob.Status.PENDING,
        ExportJob.Status.PROCESSING,
        ExportJob.Status.FAILED,
    ):
        yield _metric_line(
            "mis_export_jobs_total",
            ExportJob.objects.filter(status=status).count(),
            status=status,
        )
    for status in (Notification.Status.PENDING, Notification.Status.FAILED):
        yield _metric_line(
            "mis_notifications_total",
            Notification.objects.filter(status=status).count(),
            status=status,
        )


def render_prometheus_metrics() -> str:
    """Render metrik proses dan backlog domain dalam format Prometheus text."""
    with _metrics_lock:
        request_total = dict(_request_total)
        request_duration_ms_sum = dict(_request_duration_ms_sum)
        slow_query_total = _slow_query_total
        slow_query_duration_ms_sum = _slow_query_duration_ms_sum

    lines = [
        "# HELP mis_process_uptime_seconds Uptime proses backend saat ini.",
        "# TYPE mis_process_uptime_seconds gauge",
        _metric_line("mis_process_uptime_seconds", round(time.time() - STARTED_AT, 3)),
        "# HELP mis_http_requests_total Total request HTTP proses lokal.",
        "# TYPE mis_http_requests_total counter",
    ]
    for (method, path, status_class), total in sorted(request_total.items()):
        lines.append(
            _metric_line(
                "mis_http_requests_total",
                total,
                method=method,
                path=path,
                status_class=status_class,
            )
        )

    lines.extend(
        [
            "# HELP mis_http_request_duration_ms_sum Total durasi request HTTP.",
            "# TYPE mis_http_request_duration_ms_sum counter",
        ]
    )
    for (method, path, status_class), duration_sum in sorted(
        request_duration_ms_sum.items()
    ):
        lines.append(
            _metric_line(
                "mis_http_request_duration_ms_sum",
                round(duration_sum, 3),
                method=method,
                path=path,
                status_class=status_class,
            )
        )

    lines.extend(
        [
            "# HELP mis_db_slow_queries_total Total query database lambat proses lokal.",
            "# TYPE mis_db_slow_queries_total counter",
            _metric_line("mis_db_slow_queries_total", slow_query_total),
            "# HELP mis_db_slow_query_duration_ms_sum Total durasi query database lambat.",
            "# TYPE mis_db_slow_query_duration_ms_sum counter",
            _metric_line(
                "mis_db_slow_query_duration_ms_sum",
                round(slow_query_duration_ms_sum, 3),
            ),
            "# HELP mis_dramatiq_queue_messages Jumlah pesan pada queue Dramatiq.",
            "# TYPE mis_dramatiq_queue_messages gauge",
            "# HELP mis_dramatiq_queue_scrape_ok Status scrape queue Dramatiq.",
            "# TYPE mis_dramatiq_queue_scrape_ok gauge",
        ]
    )

    try:
        queue_depths = collect_queue_depths()
    except Exception:
        lines.append(_metric_line("mis_dramatiq_queue_scrape_ok", 0))
    else:
        lines.append(_metric_line("mis_dramatiq_queue_scrape_ok", 1))
        for depth in queue_depths:
            lines.append(
                _metric_line(
                    "mis_dramatiq_queue_messages",
                    depth.pending,
                    queue=depth.name,
                    state="pending",
                )
            )
            lines.append(
                _metric_line(
                    "mis_dramatiq_queue_messages",
                    depth.delayed,
                    queue=depth.name,
                    state="delayed",
                )
            )

    lines.extend(
        [
            "# HELP mis_database_ready Status koneksi PostgreSQL.",
            "# TYPE mis_database_ready gauge",
        ]
    )
    try:
        connection.ensure_connection()
        lines.append(_metric_line("mis_database_ready", 1))
    except Exception:  # pragma: no cover - environment failure path
        lines.append(_metric_line("mis_database_ready", 0))

    lines.extend(
        [
            "# HELP mis_domain_backlog_scrape_ok Status scrape backlog domain.",
            "# TYPE mis_domain_backlog_scrape_ok gauge",
            "# TYPE mis_outbox_unprocessed_total gauge",
            "# TYPE mis_outbox_retry_pending_total gauge",
            "# TYPE mis_export_jobs_total gauge",
            "# TYPE mis_notifications_total gauge",
        ]
    )
    try:
        domain_backlog_lines = list(_domain_backlog_metrics())
    except Exception:
        lines.append(_metric_line("mis_domain_backlog_scrape_ok", 0))
    else:
        lines.append(_metric_line("mis_domain_backlog_scrape_ok", 1))
        lines.extend(domain_backlog_lines)
    return "\n".join(lines) + "\n"
