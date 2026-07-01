"""
WSGI entrypoint fallback untuk Manufacturing Information System.

Digunakan jika perlu menjalankan Django tanpa ASGI (misalnya collectstatic).
Untuk production, gunakan ASGI via Granian.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

application = get_wsgi_application()
