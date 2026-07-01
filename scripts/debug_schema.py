import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from backend.api.masterdata import ProductVariantResponse  # noqa: E402

print("ProductVariantResponse Fields:")
for name, field in ProductVariantResponse.model_fields.items():
    print(f"{name}: {field.annotation}")
