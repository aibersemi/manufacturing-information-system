"""
Consumer WebSocket dasar untuk kanal sistem MIS.

Fitur real-time domain akan menambahkan consumer khusus. Consumer ini
memastikan jalur Channels aktif dengan session authentication dan bisa
dipakai health smoke test WebSocket dari sisi operasional.
"""

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from backend.core.models import Membership, Tenant


class SystemConsumer(AsyncJsonWebsocketConsumer):
    """WebSocket sistem yang hanya menerima user dengan session aktif."""

    tenant_id: int
    role: str
    tenant_group: str
    user_group: str

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close(code=4401)
            return

        tenant_id = self.scope.get("session", {}).get("active_tenant_id")
        context = await self._active_context(user.id, tenant_id)
        if context is None:
            await self.close(code=4403)
            return

        self.tenant_id, self.role = context
        self.tenant_group = f"tenant_{self.tenant_id}"
        self.user_group = f"user_{user.id}"
        await self.channel_layer.group_add(self.tenant_group, self.channel_name)
        await self.channel_layer.group_add(self.user_group, self.channel_name)

        await self.accept()
        await self.send_json(
            {"type": "ready", "tenant_id": self.tenant_id, "role": self.role}
        )

    async def disconnect(self, code):  # pylint: disable=unused-argument
        if hasattr(self, "tenant_group"):
            await self.channel_layer.group_discard(self.tenant_group, self.channel_name)
            await self.channel_layer.group_discard(self.user_group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})
            return

        await self.send_json({"type": "error", "detail": "Tipe pesan tidak dikenal."})

    async def system_event(self, event):
        """Event hanya berisi invalidation/path aman; data final diambil ulang via API."""
        await self.send_json(
            {
                "type": "invalidation",
                "resource": event.get("resource", "system"),
                "safe_path": event.get("safe_path", ""),
            }
        )

    @database_sync_to_async
    def _active_context(self, user_id: int, tenant_id: int | None):
        if (
            not tenant_id
            or not Tenant.objects.filter(id=tenant_id, is_active=True).exists()
        ):
            return None
        membership = Membership.objects.filter(
            user_id=user_id,
            tenant_id=tenant_id,
            is_active=True,
        ).first()
        return (tenant_id, membership.role) if membership else None
