"""
Registrasi model foundation di Django Admin.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from backend.core.models import (
    AuditEvent,
    DocumentSequence,
    FileMetadata,
    Membership,
    OutboxEvent,
    Tenant,
    User,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admin untuk custom User model."""


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "is_active", "created_at")
    list_filter = ("is_active",)
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "tenant", "role", "is_active", "created_at")
    list_filter = ("role", "is_active", "tenant")
    search_fields = ("user__username", "tenant__name")


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("action", "resource_type", "user", "tenant", "created_at")
    list_filter = ("action", "resource_type")
    search_fields = ("resource_id", "action")
    readonly_fields = (
        "id",
        "tenant",
        "user",
        "action",
        "resource_type",
        "resource_id",
        "detail",
        "ip_address",
        "request_id",
        "created_at",
    )
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        # Audit event dibuat oleh sistem, bukan manual dari admin
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(OutboxEvent)
class OutboxEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "is_processed", "retry_count", "created_at")
    list_filter = ("is_processed", "event_type")
    readonly_fields = (
        "event_type",
        "payload",
        "is_processed",
        "processed_at",
        "created_at",
        "retry_count",
    )


@admin.register(DocumentSequence)
class DocumentSequenceAdmin(admin.ModelAdmin):
    list_display = ("tenant", "document_type", "period", "current_number", "updated_at")
    list_filter = ("document_type", "period", "tenant")
    search_fields = ("tenant__name", "tenant__slug", "document_type", "period")


@admin.register(FileMetadata)
class FileMetadataAdmin(admin.ModelAdmin):
    list_display = (
        "original_filename",
        "tenant",
        "category",
        "content_type",
        "size_bytes",
        "is_archived",
        "created_at",
    )
    list_filter = ("category", "content_type", "is_archived", "tenant")
    search_fields = ("original_filename", "stored_path", "tenant__name", "tenant__slug")
    readonly_fields = (
        "id",
        "tenant",
        "uploaded_by",
        "category",
        "original_filename",
        "stored_path",
        "content_type",
        "size_bytes",
        "checksum_sha256",
        "metadata",
        "is_archived",
        "archived_at",
        "created_at",
    )
