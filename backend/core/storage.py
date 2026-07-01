"""
Helper untuk storage path tenant-scoped.

Sentralisasi konstruksi path agar tidak ada hardcode tersebar.
Semua file bisnis (upload, generate, media) disimpan di bawah:
    MEDIA_ROOT / {tenant_slug} / {category} / ...
"""

from pathlib import Path

from django.conf import settings


def get_tenant_storage_root(tenant_slug: str) -> Path:
    """
    Mengembalikan root directory storage untuk tenant tertentu.

    Contoh: /data/services/manufacturing-information-system/godebag165/
    """
    return Path(settings.MEDIA_ROOT) / tenant_slug


def get_tenant_upload_path(tenant_slug: str, category: str, filename: str) -> Path:
    """
    Mengembalikan path lengkap untuk file upload tenant.

    Args:
        tenant_slug: Slug unik konveksi.
        category: Kategori file (misalnya "receipts", "photos", "documents").
        filename: Nama file.

    Contoh: /data/services/manufacturing-information-system/godebag165/receipts/nota-001.jpg
    """
    return get_tenant_storage_root(tenant_slug) / category / filename


def ensure_tenant_directory(tenant_slug: str, category: str) -> Path:
    """
    Buat directory tenant jika belum ada dan kembalikan path-nya.

    Digunakan sebelum menyimpan file untuk memastikan directory tersedia.
    """
    directory = get_tenant_storage_root(tenant_slug) / category
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o750)
    return directory
