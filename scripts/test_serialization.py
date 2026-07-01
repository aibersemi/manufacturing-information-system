import os

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from backend.api.masterdata import ProductVariantResponse  # noqa: E402
from backend.masterdata.models import ProductVariant  # noqa: E402

variants = list(ProductVariant.objects.all()[:2])
for v in variants:
    print(v.id, type(v.id))
    try:
        res = ProductVariantResponse.from_orm(v)
        print(res.dict())
    except Exception as e:
        print("Error:", e)
