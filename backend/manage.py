#!/usr/bin/env python
"""
Django management command entrypoint untuk Manufacturing Information System.

Penggunaan:
    .venv/bin/python backend/manage.py <command>
"""

import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
    try:
        from django.core.management import (  # pylint: disable=import-outside-toplevel
            execute_from_command_line,
        )
    except ImportError as exc:
        raise ImportError(
            "Tidak dapat mengimpor Django. Pastikan virtual environment aktif "
            "dan Django sudah terinstal: .venv/bin/python -m pip install -e '.[dev]'"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
