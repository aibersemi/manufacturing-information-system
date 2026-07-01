"""
Formatter logging terstruktur untuk journald.
"""

import json
import logging
from contextvars import Token
from contextvars import ContextVar
from typing import Any

_request_context: ContextVar[dict[str, Any]] = ContextVar("request_context", default={})

OPTIONAL_RECORD_FIELDS = (
    "event",
    "request_id",
    "user_id",
    "tenant_id",
    "method",
    "path",
    "status_code",
    "duration_ms",
    "db_query_count",
    "db_duration_ms",
    "slow_query_ms",
    "sql",
    "client_ip",
)


def set_request_context(**values: Any) -> Token[dict[str, Any]]:
    """Simpan konteks request untuk filter logging berbasis contextvars."""
    current = dict(_request_context.get())
    current.update({key: value for key, value in values.items() if value is not None})
    return _request_context.set(current)


def reset_request_context(token: Token[dict[str, Any]]) -> None:
    """Kembalikan konteks logging request setelah response selesai."""
    _request_context.reset(token)


class RequestContextFilter(logging.Filter):
    """Tambahkan konteks request ke setiap record log dalam request aktif."""

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in _request_context.get().items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


class JsonFormatter(logging.Formatter):
    """Format log sebagai JSON satu baris agar mudah diproses observability."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "process": record.process,
        }
        for field in OPTIONAL_RECORD_FIELDS:
            value = getattr(record, field, None)
            if value not in (None, ""):
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)
