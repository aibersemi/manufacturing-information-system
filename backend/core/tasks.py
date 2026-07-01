"""
Task Dramatiq untuk background processing MIS.
"""

import hashlib
import os
import uuid
from datetime import date

import django
from django.apps import apps

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
if not apps.ready:
    django.setup()

# Model dan actor baru boleh diimpor setelah registry aplikasi Django siap.
# pylint: disable=wrong-import-position,ungrouped-imports
import dramatiq  # noqa: E402
from django.conf import settings  # noqa: E402
from django.db.models import F  # noqa: E402
from django.utils import timezone  # noqa: E402

from backend.core.models import (  # noqa: E402
    ExportJob,
    FileMetadata,
    Notification,
    OutboxEvent,
)
from backend.core.notification_delivery import send_telegram_notification  # noqa: E402
from backend.core.reporting import report_dataset  # noqa: E402
from backend.core.search import apply_search_event  # noqa: E402
from backend.core.storage import ensure_tenant_directory  # noqa: E402
from backend.core.xlsx import write_xlsx  # noqa: E402
from backend.dramatiq_config import configure_broker  # noqa: E402

configure_broker()


@dramatiq.actor(max_retries=3, min_backoff=1000, max_backoff=30000)
def process_outbox_event(event_id: int) -> None:
    """
    Proses satu event search outbox secara idempotent.

    Jika worker menerima pesan ganda, event yang sudah `is_processed=True`
    langsung diabaikan. Kegagalan komunikasi dengan Meilisearch menaikkan
    `retry_count` lalu exception dibiarkan agar Dramatiq melakukan retry.
    """
    event = OutboxEvent.objects.filter(id=event_id).first()
    if event is None or event.is_processed:
        return

    try:
        apply_search_event(event.payload)
    except Exception:
        OutboxEvent.objects.filter(id=event_id).update(retry_count=F("retry_count") + 1)
        raise

    event.is_processed = True
    event.processed_at = timezone.now()
    event.save(update_fields=["is_processed", "processed_at"])


@dramatiq.actor(max_retries=5, min_backoff=5000, max_backoff=300000)
def deliver_notification(notification_id: str) -> None:
    """Kirim notifikasi eksternal secara idempotent dengan retry."""

    notification = Notification.objects.filter(id=notification_id).first()
    if notification is None or notification.status == Notification.Status.SENT:
        return
    try:
        send_telegram_notification(notification)
    except Exception as exc:
        Notification.objects.filter(id=notification_id).update(
            attempt_count=F("attempt_count") + 1,
            status=Notification.Status.FAILED,
            last_error=str(exc)[:1000],
        )
        raise


@dramatiq.actor(max_retries=3, min_backoff=5000, max_backoff=60000)
def generate_report_export(job_id: str) -> None:
    """Generate XLSX tenant-scoped; aman ketika task diterima ulang."""

    job = (
        ExportJob.objects.select_related("tenant", "requested_by", "file")
        .filter(id=job_id)
        .first()
    )
    if job is None or job.status == ExportJob.Status.COMPLETED:
        return
    job.status = ExportJob.Status.PROCESSING
    job.save(update_fields=["status"])
    try:
        date_from = (
            date.fromisoformat(job.filters["date_from"])
            if job.filters.get("date_from")
            else None
        )
        date_to = (
            date.fromisoformat(job.filters["date_to"])
            if job.filters.get("date_to")
            else None
        )
        headers, rows = report_dataset(
            job.tenant,
            job.report_type,
            date_from=date_from,
            date_to=date_to,
        )
        directory = ensure_tenant_directory(job.tenant.slug, "exports")
        filename = f"{uuid.uuid4().hex}.xlsx"
        path = directory / filename
        write_xlsx(path, headers, rows)
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        metadata = FileMetadata.objects.create(
            tenant=job.tenant,
            uploaded_by=job.requested_by,
            category="exports",
            resource_type="ExportJob",
            resource_id=str(job.id),
            original_filename=f"{job.report_type}.xlsx",
            stored_path=str(path.relative_to(settings.MEDIA_ROOT)),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size_bytes=path.stat().st_size,
            checksum_sha256=checksum,
        )
        job.status = ExportJob.Status.COMPLETED
        job.file = metadata
        job.completed_at = timezone.now()
        job.error = ""
        job.save(update_fields=["status", "file", "completed_at", "error"])
    except Exception as exc:
        job.status = ExportJob.Status.FAILED
        job.error = str(exc)[:2000]
        job.save(update_fields=["status", "error"])
        raise
