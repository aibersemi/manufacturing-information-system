"""Pengiriman notifikasi eksternal tanpa dependensi balik ke actor Dramatiq."""

import json
import urllib.parse
import urllib.request

from django.conf import settings
from django.utils import timezone

from backend.core.models import Notification


def build_notification_text(notification: Notification) -> str:
    text = f"{notification.title}\n{notification.message}"
    if notification.safe_path:
        public_frontend_url = settings.PUBLIC_FRONTEND_URL.rstrip("/")
        text = f"{text}\n{public_frontend_url}{notification.safe_path}"
    return text


def send_telegram_notification(notification: Notification) -> None:
    """Kirim satu notifikasi Telegram dan simpan status akhirnya."""
    if notification.channel != Notification.Channel.TELEGRAM:
        return
    if notification.status == Notification.Status.SENT:
        return
    token = settings.TELEGRAM_BOT_TOKEN
    chat_id = notification.metadata.get("chat_id")
    if not token or not chat_id:
        raise ValueError("Konfigurasi Telegram belum lengkap.")
    text = build_notification_text(notification)
    body = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode()
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=body,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310
        result = json.loads(response.read())
    if not result.get("ok"):
        raise RuntimeError("Telegram menolak notifikasi.")
    notification.status = Notification.Status.SENT
    notification.sent_at = timezone.now()
    notification.attempt_count += 1
    notification.last_error = ""
    notification.save(
        update_fields=["status", "sent_at", "attempt_count", "last_error"]
    )
