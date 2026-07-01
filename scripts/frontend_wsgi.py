"""WSGI origin untuk menyajikan build React/Vite secara aman."""

from __future__ import annotations

import mimetypes
import os
from email.utils import formatdate
from pathlib import Path
from typing import Callable, Iterable
from wsgiref.util import FileWrapper

StartResponse = Callable[[str, list[tuple[str, str]]], object]

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIST_ROOT = REPOSITORY_ROOT / "frontend" / "dist"


def _plain_response(
    start_response: StartResponse,
    status: str,
    message: str,
    *,
    headers: list[tuple[str, str]] | None = None,
    include_body: bool = True,
) -> list[bytes]:
    body = message.encode("utf-8")
    response_headers = [
        ("Content-Type", "text/plain; charset=utf-8"),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
    ]
    if headers:
        response_headers.extend(headers)
    start_response(status, response_headers)
    return [body] if include_body else []


def _is_safe_path(path: str) -> bool:
    if "\x00" in path or "\\" in path:
        return False

    segments = [segment for segment in path.split("/") if segment]
    return not any(
        segment in {".", ".."} or segment.startswith(".") for segment in segments
    )


def _resolve_file(root: Path, request_path: str) -> Path | None:
    candidate = (root / request_path.lstrip("/")).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


def _should_use_spa_fallback(request_path: str) -> bool:
    relative_path = request_path.strip("/")
    if not relative_path:
        return True
    if relative_path == "assets" or relative_path.startswith("assets/"):
        return False
    return Path(relative_path).suffix == ""


def _cache_control(file_path: Path, root: Path) -> str:
    relative_path = file_path.relative_to(root)
    if relative_path == Path("index.html"):
        return "no-cache, no-store, must-revalidate"
    if relative_path.parts and relative_path.parts[0] == "assets":
        return "public, max-age=31536000, immutable"
    return "public, max-age=3600"


def create_application(dist_root: str | Path) -> Callable:
    """Buat aplikasi WSGI yang hanya membaca file dari direktori build."""

    root = Path(dist_root).resolve()

    def wsgi_application(
        environ: dict, start_response: StartResponse
    ) -> Iterable[bytes]:
        method = str(environ.get("REQUEST_METHOD", "GET")).upper()
        if method not in {"GET", "HEAD"}:
            return _plain_response(
                start_response,
                "405 Method Not Allowed",
                "Method Not Allowed",
                headers=[("Allow", "GET, HEAD")],
            )

        request_path = str(environ.get("PATH_INFO", "/"))
        if not request_path.startswith("/") or not _is_safe_path(request_path):
            return _plain_response(
                start_response,
                "404 Not Found",
                "Not Found",
                include_body=method != "HEAD",
            )

        file_path = _resolve_file(root, request_path)
        if file_path is None and _should_use_spa_fallback(request_path):
            file_path = _resolve_file(root, "/index.html")
        if file_path is None:
            return _plain_response(
                start_response,
                "404 Not Found",
                "Not Found",
                include_body=method != "HEAD",
            )

        stat = file_path.stat()
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        response_headers = [
            (
                "Content-Type",
                mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
            ),
            ("Content-Length", str(stat.st_size)),
            ("Cache-Control", _cache_control(file_path, root)),
            ("ETag", etag),
            ("Last-Modified", formatdate(stat.st_mtime, usegmt=True)),
            ("X-Content-Type-Options", "nosniff"),
        ]

        if environ.get("HTTP_IF_NONE_MATCH") == etag:
            start_response("304 Not Modified", response_headers)
            return []

        start_response("200 OK", response_headers)
        if method == "HEAD":
            return []

        file_object = file_path.open("rb")
        wrapper = environ.get("wsgi.file_wrapper", FileWrapper)
        return wrapper(file_object, 64 * 1024)

    return wsgi_application


application = create_application(
    os.environ.get("FRONTEND_DIST_ROOT", DEFAULT_DIST_ROOT)
)
