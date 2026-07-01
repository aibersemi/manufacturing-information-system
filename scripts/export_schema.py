import json
import os
import sys

import django

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

# API baru dapat dibangun setelah registry aplikasi Django siap.
# pylint: disable=wrong-import-position
from backend.api import api  # noqa: E402

with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(api.get_openapi_schema(), f)
