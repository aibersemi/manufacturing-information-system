"""Penyimpanan file bisnis privat dan tenant-scoped."""

from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import transaction
from django.utils import timezone

from backend.core.models import FileMetadata, Tenant, User
from backend.core.services import record_audit
from backend.core.storage import ensure_tenant_directory

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf", ".xlsx"}
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _safe_category(value: str) -> str:
    category = value.strip().lower().replace("_", "-")
    if not category or not all(
        character.isalnum() or character == "-" for character in category
    ):
        raise ValueError("Kategori file tidak valid.")
    return category


@transaction.atomic
def store_business_file(
    *,
    tenant: Tenant,
    user: User,
    uploaded_file: UploadedFile,
    category: str,
    resource_type: str = "",
    resource_id: str = "",
) -> FileMetadata:
    category = _safe_category(category)
    suffix = Path(uploaded_file.name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError("Ekstensi file tidak diizinkan.")
    if uploaded_file.content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError("Tipe konten file tidak diizinkan.")
    if uploaded_file.size > MAX_FILE_SIZE:
        raise ValueError("Ukuran file melebihi batas 10 MB.")

    directory = ensure_tenant_directory(tenant.slug, category)
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    target = (directory / stored_name).resolve()
    media_root = Path(settings.MEDIA_ROOT).resolve()
    if not target.is_relative_to(media_root):
        raise ValueError("Path penyimpanan tidak valid.")
    digest = hashlib.sha256()
    try:
        with target.open("xb") as destination:
            for chunk in uploaded_file.chunks():
                digest.update(chunk)
                destination.write(chunk)
        target.chmod(0o640)
        metadata = FileMetadata.objects.create(
            tenant=tenant,
            uploaded_by=user,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            original_filename=Path(uploaded_file.name).name[:255],
            stored_path=str(target.relative_to(media_root)),
            content_type=uploaded_file.content_type,
            size_bytes=uploaded_file.size,
            checksum_sha256=digest.hexdigest(),
        )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    record_audit(
        tenant=tenant,
        user=user,
        action="business_file_uploaded",
        resource_type="FileMetadata",
        resource_id=metadata.id,
        after={
            "category": category,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "size_bytes": uploaded_file.size,
            "checksum": metadata.checksum_sha256,
        },
    )
    return metadata


@transaction.atomic
def store_generated_file(
    *,
    tenant: Tenant,
    user: User,
    content: bytes,
    filename: str,
    category: str,
    resource_type: str,
    resource_id: str,
    content_type: str,
) -> FileMetadata:
    """Simpan dokumen ciptaan aplikasi dengan kontrol yang sama seperti upload."""
    category = _safe_category(category)
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS or content_type not in ALLOWED_CONTENT_TYPES:
        raise ValueError("Tipe dokumen hasil generate tidak diizinkan.")
    if len(content) > MAX_FILE_SIZE:
        raise ValueError("Ukuran dokumen hasil generate melebihi batas 10 MB.")
    existing = FileMetadata.objects.filter(
        tenant=tenant,
        category=category,
        resource_type=resource_type,
        resource_id=resource_id,
        checksum_sha256=hashlib.sha256(content).hexdigest(),
        is_archived=False,
    ).first()
    if existing:
        return existing

    directory = ensure_tenant_directory(tenant.slug, category)
    target = (directory / f"{uuid.uuid4().hex}{suffix}").resolve()
    media_root = Path(settings.MEDIA_ROOT).resolve()
    if not target.is_relative_to(media_root):
        raise ValueError("Path penyimpanan tidak valid.")
    try:
        target.write_bytes(content)
        target.chmod(0o640)
        metadata = FileMetadata.objects.create(
            tenant=tenant,
            uploaded_by=user,
            category=category,
            resource_type=resource_type,
            resource_id=resource_id,
            original_filename=Path(filename).name[:255],
            stored_path=str(target.relative_to(media_root)),
            content_type=content_type,
            size_bytes=len(content),
            checksum_sha256=hashlib.sha256(content).hexdigest(),
        )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    record_audit(
        tenant=tenant,
        user=user,
        action="business_file_generated",
        resource_type=resource_type,
        resource_id=resource_id,
        after={"file_id": metadata.id, "filename": metadata.original_filename},
    )
    return metadata


def resolve_business_file(metadata: FileMetadata) -> Path:
    media_root = Path(settings.MEDIA_ROOT).resolve()
    target = (media_root / metadata.stored_path).resolve()
    tenant_root = (media_root / metadata.tenant.slug).resolve()
    if not target.is_relative_to(tenant_root) or not target.is_file():
        raise FileNotFoundError("File bisnis tidak ditemukan.")
    return target


def archive_business_file(metadata: FileMetadata, *, user: User) -> FileMetadata:
    if metadata.is_archived:
        return metadata
    metadata.is_archived = True
    metadata.archived_at = timezone.now()
    metadata.save(update_fields=["is_archived", "archived_at"])
    record_audit(
        tenant=metadata.tenant,
        user=user,
        action="business_file_archived",
        resource_type="FileMetadata",
        resource_id=metadata.id,
        after={"is_archived": True},
    )
    return metadata
