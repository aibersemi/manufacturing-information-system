"""
Konfigurasi broker Dramatiq untuk MIS.

Modul ini dipanggil sebelum actor dideklarasikan agar worker dan proses web
memakai Redis DB 0 yang sama untuk antrean background task.
"""

from functools import cache

import dramatiq
from django.conf import settings
from dramatiq.brokers.redis import RedisBroker


@cache
def configure_broker() -> RedisBroker:
    """Set broker Dramatiq eksplisit ke Redis DB 0 dari settings."""
    broker = RedisBroker(url=settings.REDIS_BROKER_URL)
    dramatiq.set_broker(broker)
    return broker
