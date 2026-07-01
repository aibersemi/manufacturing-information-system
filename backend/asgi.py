"""
ASGI entrypoint untuk Manufacturing Information System.

Granian menjalankan file ini dalam mode ASGI:
  granian --interface asgi backend.asgi:application
"""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

# Impor Django setup sebelum import Channels
# pylint: disable=wrong-import-position
import django  # noqa: E402

django.setup()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

from backend.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": AllowedHostsOriginValidator(
            AuthMiddlewareStack(URLRouter(websocket_urlpatterns))
        ),
    }
)
