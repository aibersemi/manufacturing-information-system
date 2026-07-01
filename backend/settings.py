"""
Django settings untuk Manufacturing Information System (MIS).

Seluruh konfigurasi sensitif dibaca dari environment variables.
Lihat .env.example untuk daftar variabel yang diperlukan.
"""

import os
from pathlib import Path
from urllib.parse import urlsplit

from corsheaders.defaults import default_headers
from dotenv import load_dotenv

# Muat .env dari root repo
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# --- Security ---

SECRET_KEY = os.environ["SECRET_KEY"]

DEBUG = os.environ.get("DEBUG", "False").lower() in ("true", "1", "yes")

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("ALLOWED_HOSTS", "localhost").split(",")
    if h.strip()
]

CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    if o.strip()
]

CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = (*default_headers, "x-request-id")

# URL publik dan bind host konkret dikelola di .env privat.
def _origin_from_url(value: str | None) -> str:
    raw_value = (value or "").strip().rstrip("/")
    if not raw_value:
        return ""
    parsed = urlsplit(raw_value)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return raw_value


def _websocket_origin_from_http(value: str) -> str:
    if value.startswith("https://"):
        return f"wss://{value.removeprefix('https://')}"
    if value.startswith("http://"):
        return f"ws://{value.removeprefix('http://')}"
    return value


PUBLIC_FRONTEND_URL = (
    _origin_from_url(os.environ.get("PUBLIC_FRONTEND_URL"))
    or (CORS_ALLOWED_ORIGINS[0] if CORS_ALLOWED_ORIGINS else "")
    or "http://localhost:8015"
)
PUBLIC_API_URL = (
    _origin_from_url(os.environ.get("PUBLIC_API_URL"))
    or _origin_from_url(os.environ.get("VITE_API_BASE_URL"))
    or "http://localhost:8016"
)
PUBLIC_API_WS_URL = _origin_from_url(
    os.environ.get("PUBLIC_API_WS_URL")
) or _websocket_origin_from_http(PUBLIC_API_URL)

# TLS dihentikan di reverse proxy privat.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# --- Application Definition ---

INSTALLED_APPS = [
    "corsheaders",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "channels",
    # Aplikasi lokal
    "backend.core",
    "backend.masterdata",
    "backend.production",
    "backend.inventory",
    "backend.sales",
    "backend.labor",
    "backend.finance",
    "backend.accounting",
]

MIDDLEWARE = [
    "backend.middleware.RequestIDMiddleware",
    "backend.middleware.ObservabilityMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "backend.middleware.ResponseSecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "backend.middleware.MutationAuditMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backend.wsgi.application"
ASGI_APPLICATION = "backend.asgi.application"

# --- Custom User Model ---
# Ditetapkan sejak awal agar tidak perlu migrasi berat di kemudian hari.
AUTH_USER_MODEL = "core.User"

# --- Database ---

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "manufacturing_is"),
        "USER": os.environ.get("DB_USER", "mis_app"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": 600,
        "OPTIONS": {
            "connect_timeout": 5,
        },
    }
}

# --- Cache (Redis DB 1) ---

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
REDIS_BROKER_URL = os.environ.get("REDIS_BROKER_URL", f"{REDIS_URL.rstrip('/')}/0")
REDIS_RUNTIME_URL = os.environ.get("REDIS_RUNTIME_URL", f"{REDIS_URL.rstrip('/')}/1")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_RUNTIME_URL,
    }
}

# --- Channels (Redis DB 1) ---

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_RUNTIME_URL],
        },
    },
}

# --- Dramatiq (Redis DB 0) ---

DRAMATIQ_BROKER = {
    "BROKER": "dramatiq.brokers.redis.RedisBroker",
    "OPTIONS": {
        "url": REDIS_BROKER_URL,
    },
}

# --- Meilisearch ---

MEILISEARCH_URL = os.environ.get("MEILISEARCH_URL", "http://localhost:7700")
MEILISEARCH_API_KEY = os.environ.get("MEILISEARCH_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

# --- Observability ---

OBSERVABILITY_SLOW_QUERY_MS = int(os.environ.get("OBSERVABILITY_SLOW_QUERY_MS", "500"))
OBSERVABILITY_DRAMATIQ_QUEUES = [
    queue.strip()
    for queue in os.environ.get("OBSERVABILITY_DRAMATIQ_QUEUES", "default").split(",")
    if queue.strip()
]

# --- Password Validation ---

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internationalization & Timezone ---
# Timestamp disimpan dalam UTC; display menggunakan Asia/Jakarta (WIB)
# melalui service layer, bukan setting TIME_ZONE global.

LANGUAGE_CODE = "id"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static & Media Files ---

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = os.environ.get(
    "MEDIA_ROOT",
    "/data/services/manufacturing-information-system",
)

DATA_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get("DATA_UPLOAD_MAX_MEMORY_SIZE", str(5 * 1024 * 1024))
)
FILE_UPLOAD_MAX_MEMORY_SIZE = int(
    os.environ.get("FILE_UPLOAD_MAX_MEMORY_SIZE", str(10 * 1024 * 1024))
)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Session & Cookie Security ---
# Autentikasi murni berbasis session cookie sesuai arsitektur.

SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 hari

CSRF_COOKIE_HTTPONLY = False  # False agar JavaScript bisa baca CSRF token
CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_DOMAIN = os.environ.get("CSRF_COOKIE_DOMAIN") or None

# --- Logging ---
# Structured logging ke stdout/stderr untuk dibaca oleh journalctl.

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_context": {
            "()": "backend.logging_config.RequestContextFilter",
        },
    },
    "formatters": {
        "json": {
            "()": "backend.logging_config.JsonFormatter",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "filters": ["request_context"],
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "backend": {
            "handlers": ["console"],
            "level": "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
    },
}
