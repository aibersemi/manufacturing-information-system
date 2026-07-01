import re

PRODUCT_VARIANT_SKU_PATTERN = r"^[A-Z0-9_]+-[A-Z0-9_]+-[A-Z0-9_]+$"
PRODUCT_MODEL_CODE_PATTERN = r"^[A-Z0-9_]+$"
PRODUCT_VARIANT_SKU_MAX_LENGTH = 100

_SEGMENT_ALLOWED_RE = re.compile(r"^[A-Z0-9_]+$")


def normalize_sku_segment(value: str, *, default_zero: bool = False) -> str:
    segment = re.sub(r"\s+", "_", value.strip().upper())
    if not segment:
        if default_zero:
            return "0"
        raise ValueError("Segmen SKU wajib diisi.")
    if "-" in segment:
        raise ValueError("Segmen SKU tidak boleh mengandung tanda '-'.")
    if not _SEGMENT_ALLOWED_RE.fullmatch(segment):
        raise ValueError("Segmen SKU hanya boleh berisi huruf, angka, dan underscore.")
    return segment


def build_product_variant_sku(model_code: str, color: str = "", size: str = "") -> str:
    sku = "-".join(
        [
            normalize_sku_segment(model_code),
            normalize_sku_segment(color, default_zero=True),
            normalize_sku_segment(size, default_zero=True),
        ]
    )
    if len(sku) > PRODUCT_VARIANT_SKU_MAX_LENGTH:
        raise ValueError("SKU tidak boleh lebih dari 100 karakter.")
    return sku
