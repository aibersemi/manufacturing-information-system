from types import SimpleNamespace

from django.test import override_settings

from backend.core.notification_delivery import build_notification_text
from backend.middleware import build_csp_policy


@override_settings(
    PUBLIC_FRONTEND_URL="https://app.example.test",
    PUBLIC_API_WS_URL="wss://api.example.test",
)
def test_csp_policy_menggunakan_public_origin_dari_settings():
    policy = build_csp_policy()

    assert "form-action 'self' https://app.example.test" in policy
    assert "connect-src 'self' https://app.example.test wss://api.example.test" in policy


@override_settings(PUBLIC_FRONTEND_URL="https://app.example.test")
def test_notification_text_menggunakan_public_frontend_url():
    notification = SimpleNamespace(
        title="Judul",
        message="Pesan",
        safe_path="/finance/payment-requests/1",
    )

    assert build_notification_text(notification) == (
        "Judul\nPesan\nhttps://app.example.test/finance/payment-requests/1"
    )
