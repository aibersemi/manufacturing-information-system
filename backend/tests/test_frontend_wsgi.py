"""Pengujian origin WSGI untuk build frontend."""

# Fixture pytest sengaja diinjeksikan melalui nama argumen test.
# pylint: disable=redefined-outer-name

from wsgiref.util import setup_testing_defaults

import pytest

from scripts.frontend_wsgi import create_application


def request(application, path="/", method="GET", headers=None):
    environ = {}
    setup_testing_defaults(environ)
    environ["PATH_INFO"] = path
    environ["REQUEST_METHOD"] = method
    for name, value in (headers or {}).items():
        environ[f"HTTP_{name.upper().replace('-', '_')}"] = value

    response = {}

    def start_response(status, response_headers):
        response["status"] = status
        response["headers"] = dict(response_headers)

    body_iterator = application(environ, start_response)
    try:
        response["body"] = b"".join(body_iterator)
    finally:
        close = getattr(body_iterator, "close", None)
        if close:
            close()
    return response


@pytest.fixture
def frontend_app(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<main>frontend MIS</main>")
    (tmp_path / "assets" / "app-abc123.js").write_text("console.log('MIS')")
    return create_application(tmp_path)


def test_root_serves_index_without_cache(frontend_app):
    response = request(frontend_app)

    assert response["status"] == "200 OK"
    assert response["body"] == b"<main>frontend MIS</main>"
    assert response["headers"]["Cache-Control"] == "no-cache, no-store, must-revalidate"


def test_deep_route_uses_spa_fallback(frontend_app):
    response = request(frontend_app, "/app/produksi")

    assert response["status"] == "200 OK"
    assert response["body"] == b"<main>frontend MIS</main>"


def test_hashed_asset_uses_immutable_cache(frontend_app):
    response = request(frontend_app, "/assets/app-abc123.js")

    assert response["status"] == "200 OK"
    assert response["headers"]["Cache-Control"] == "public, max-age=31536000, immutable"
    assert response["headers"]["Content-Type"] in {
        "text/javascript",
        "application/javascript",
    }


def test_head_returns_headers_without_body(frontend_app):
    response = request(frontend_app, "/assets/app-abc123.js", method="HEAD")

    assert response["status"] == "200 OK"
    assert response["body"] == b""
    assert response["headers"]["Content-Length"] == str(len("console.log('MIS')"))


def test_head_missing_asset_returns_404_without_body(frontend_app):
    response = request(frontend_app, "/assets/missing.js", method="HEAD")

    assert response["status"] == "404 Not Found"
    assert response["body"] == b""


@pytest.mark.parametrize(
    "path",
    ["/assets/missing.js", "/.env", "/../secret", "/assets/../index.html"],
)
def test_unsafe_or_missing_path_returns_404(frontend_app, path):
    response = request(frontend_app, path)

    assert response["status"] == "404 Not Found"


def test_directory_does_not_show_listing(frontend_app):
    response = request(frontend_app, "/assets/")

    assert response["status"] == "404 Not Found"


def test_symlink_outside_dist_is_rejected(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("index")
    secret = tmp_path / "secret.txt"
    secret.write_text("rahasia")
    (dist / "leak.txt").symlink_to(secret)

    response = request(create_application(dist), "/leak.txt")

    assert response["status"] == "404 Not Found"
    assert b"rahasia" not in response["body"]


def test_method_other_than_get_or_head_is_rejected(frontend_app):
    response = request(frontend_app, method="POST")

    assert response["status"] == "405 Method Not Allowed"
    assert response["headers"]["Allow"] == "GET, HEAD"
