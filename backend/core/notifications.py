"""Notifikasi in-app/Telegram yang tenant-scoped dan idempotent."""

from __future__ import annotations

from django.db import transaction

from backend.core.models import Membership, Notification, Tenant
from backend.core.services import ensure_business_policy
from backend.masterdata.models import Operator


def create_role_notifications(
    *,
    tenant: Tenant,
    event_type: str,
    title: str,
    message: str,
    safe_path: str,
    deduplication_key: str,
    roles: set[str],
    operator_types: set[str] | None = None,
    telegram: bool = False,
) -> list[Notification]:
    user_ids = set(
        Membership.objects.filter(
            tenant=tenant, role__in=roles, is_active=True, user__is_active=True
        ).values_list("user_id", flat=True)
    )
    if operator_types:
        user_ids.update(
            Operator.objects.filter(
                tenant=tenant,
                operator_type__in=operator_types,
                is_active=True,
                user__is_active=True,
            ).values_list("user_id", flat=True)
        )
    notifications = []
    for user_id in filter(None, user_ids):
        notification, _created = Notification.objects.get_or_create(
            tenant=tenant,
            recipient_id=user_id,
            channel=Notification.Channel.IN_APP,
            deduplication_key=f"{deduplication_key}:user:{user_id}",
            defaults={
                "event_type": event_type,
                "title": title,
                "message": message,
                "safe_path": safe_path,
            },
        )
        notifications.append(notification)
    if telegram:
        chat_ids = ensure_business_policy(tenant).telegram_chat_ids.get(event_type, [])
        for chat_id in chat_ids:
            notification, _created = Notification.objects.get_or_create(
                tenant=tenant,
                channel=Notification.Channel.TELEGRAM,
                deduplication_key=f"{deduplication_key}:chat:{chat_id}",
                defaults={
                    "event_type": event_type,
                    "title": title,
                    "message": message,
                    "safe_path": safe_path,
                    "metadata": {"chat_id": str(chat_id)},
                },
            )
            notifications.append(notification)
    if telegram:
        from backend.core.tasks import (  # pylint: disable=import-outside-toplevel
            deliver_notification,
        )

        for notification in notifications:
            if notification.channel == Notification.Channel.TELEGRAM:
                transaction.on_commit(
                    lambda notification_id=str(notification.id): (
                        deliver_notification.send(notification_id)
                    )
                )
    return notifications
