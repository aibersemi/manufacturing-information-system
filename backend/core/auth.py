"""
Kompatibilitas import untuk router autentikasi.

Router runtime berada di `backend.api.auth` agar operationId OpenAPI tetap
stabil untuk client Orval. Modul ini dipertahankan untuk import lama.
"""

from backend.api.auth import router

__all__ = ["router"]
