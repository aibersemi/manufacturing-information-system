import re

from django.db import migrations, models


def _normalize_segment(value, *, default_zero=False):
    segment = re.sub(r"\s+", "_", (value or "").strip().upper())
    if not segment:
        if default_zero:
            return "0"
        raise ValueError("Segmen SKU wajib diisi.")
    if "-" in segment:
        raise ValueError("Segmen SKU tidak boleh mengandung tanda '-'.")
    if not re.fullmatch(r"[A-Z0-9_]+", segment):
        raise ValueError("Segmen SKU hanya boleh berisi huruf, angka, dan underscore.")
    return segment


def _build_sku(model_code, color="", size=""):
    sku = "-".join(
        [
            _normalize_segment(model_code),
            _normalize_segment(color, default_zero=True),
            _normalize_segment(size, default_zero=True),
        ]
    )
    if len(sku) > 100:
        raise ValueError("SKU tidak boleh lebih dari 100 karakter.")
    return sku


def standardize_product_skus(apps, _schema_editor):
    ProductModel = apps.get_model("masterdata", "ProductModel")
    ProductVariant = apps.get_model("masterdata", "ProductVariant")

    seen_model_codes = set()
    for product_model in ProductModel.objects.order_by("tenant_id", "id"):
        try:
            normalized_code = _normalize_segment(product_model.code)
        except ValueError as exc:
            raise RuntimeError(
                f"Kode model {product_model.id} tidak valid: {exc}"
            ) from exc
        model_key = (product_model.tenant_id, normalized_code)
        if model_key in seen_model_codes:
            raise RuntimeError(
                "Normalisasi kode model menghasilkan duplikasi "
                f"tenant={product_model.tenant_id} code={normalized_code}."
            )
        seen_model_codes.add(model_key)
        if product_model.code != normalized_code:
            product_model.code = normalized_code
            product_model.save(update_fields=["code"])

    seen_variant_skus = set()
    variants = ProductVariant.objects.select_related("product_model").order_by(
        "tenant_id", "id"
    )
    for variant in variants:
        try:
            normalized_sku = _build_sku(
                variant.product_model.code, variant.color, variant.size
            )
        except ValueError as exc:
            raise RuntimeError(
                f"Varian produk {variant.id} tidak dapat dinormalisasi: {exc}"
            ) from exc
        variant_key = (variant.tenant_id, normalized_sku)
        if variant_key in seen_variant_skus:
            raise RuntimeError(
                "Normalisasi SKU varian menghasilkan duplikasi "
                f"tenant={variant.tenant_id} sku={normalized_sku}."
            )
        seen_variant_skus.add(variant_key)
        if variant.sku != normalized_sku:
            variant.sku = normalized_sku
            variant.save(update_fields=["sku"])


class Migration(migrations.Migration):
    dependencies = [
        ("masterdata", "0006_update_default_uom_dimensions"),
    ]

    operations = [
        migrations.AlterField(
            model_name="productvariant",
            name="sku",
            field=models.CharField(
                blank=True, default="", max_length=100, verbose_name="SKU"
            ),
        ),
        migrations.RunPython(standardize_product_skus, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="productmodel",
            constraint=models.CheckConstraint(
                condition=models.Q(("code__regex", "^[A-Z0-9_]+$")),
                name="masterdata_product_model_code_format",
            ),
        ),
        migrations.AddConstraint(
            model_name="productvariant",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("sku__regex", "^[A-Z0-9_]+-[A-Z0-9_]+-[A-Z0-9_]+$")
                ),
                name="masterdata_product_variant_sku_format",
            ),
        ),
    ]
