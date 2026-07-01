"""
Routing WebSocket ASGI untuk MIS.
"""

from django.urls import path

from backend.core.consumers import SystemConsumer

websocket_urlpatterns = [
    path("ws/system/", SystemConsumer.as_asgi()),
]
