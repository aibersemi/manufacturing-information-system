"""
Signal outbox untuk search projection.

Receiver hanya membuat OutboxEvent untuk model yang terdaftar pada
`backend.core.search.SEARCH_INDEXES`. Worker Dramatiq baru dipanggil setelah
transaksi database berhasil commit.
"""

from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from backend.core.models import AuditEvent, Membership, OutboxEvent, Tenant
from backend.core.search import build_outbox_payload, get_index_for_instance


def _create_outbox_event(instance, action: str) -> None:
    index = get_index_for_instance(instance)
    if index is None:
        return

    payload = build_outbox_payload(instance, action)
    if payload is None:
        return

    event = OutboxEvent.objects.create(
        tenant_id=getattr(instance, "tenant_id", None),
        event_type=f"{index.uid}_{action}",
        payload=payload,
        deduplication_key=(
            f"{index.uid}:{instance.pk}:{action}:{getattr(instance, 'updated_at', '')}"
        ),
    )

    def trigger_task():
        from backend.core.tasks import (  # pylint: disable=import-outside-toplevel
            process_outbox_event,
        )

        process_outbox_event.send(event.id)

    transaction.on_commit(trigger_task)


@receiver(post_save, dispatch_uid="core_search_outbox_post_save")
def model_post_save(instance, raw=False, **kwargs):
    if raw:
        return
    _create_outbox_event(instance, action="upsert")


@receiver(post_delete, dispatch_uid="core_search_outbox_post_delete")
def model_post_delete(instance, **kwargs):
    _create_outbox_event(instance, action="delete")


@receiver(post_save, sender=Tenant, dispatch_uid="core_bootstrap_new_tenant")
def bootstrap_new_tenant(instance, created=False, raw=False, **kwargs):
    if not created or raw:
        return

    def bootstrap():
        from backend.masterdata.services import (  # pylint: disable=import-outside-toplevel
            bootstrap_tenant,
        )

        bootstrap_tenant(instance)

    transaction.on_commit(bootstrap)


@receiver(pre_save, sender=Membership, dispatch_uid="core_membership_before_change")
def membership_before_change(instance, raw=False, **kwargs):
    if raw or not instance.pk:
        return
    setattr(
        instance,
        "_audit_before",
        Membership.objects.filter(pk=instance.pk)
        .values("role", "is_active", "tenant_id", "user_id")
        .first(),
    )


@receiver(post_save, sender=Membership, dispatch_uid="core_membership_audit")
def membership_audit(instance, created=False, raw=False, **kwargs):
    if raw:
        return
    before = getattr(instance, "_audit_before", None)
    after = {
        "role": instance.role,
        "is_active": instance.is_active,
        "tenant_id": instance.tenant_id,
        "user_id": instance.user_id,
    }
    if not created and before == after:
        return
    AuditEvent.objects.create(
        tenant=instance.tenant,
        user=None,
        action="membership_created" if created else "membership_changed",
        resource_type="Membership",
        resource_id=str(instance.pk),
        detail={"before": before or {}, "after": after},
    )
