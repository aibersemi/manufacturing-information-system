import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from backend.api.masterdata import ProductVariantResponse  # noqa: E402

print(ProductVariantResponse.model_fields["id"].annotation)
