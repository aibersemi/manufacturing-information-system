from decimal import Decimal

import pytest
from django.core.management import call_command

from backend.core.models import Tenant
from backend.finance.models import Asset
from backend.inventory.models import (
    MaterialLedger,
    MaterialReceiptLine,
    PurchaseOrder,
    PurchaseOrderLine,
)
from backend.masterdata.models import (
    BOM,
    BOMItem,
    CostCategory,
    Material,
    PieceRate,
    ProductVariant,
    UOM,
)
from backend.tests.test_seed_dummy_konveksi_command import set_dummy_env


@pytest.mark.django_db
def test_material_allows_cross_dimension_purchase_to_usage_conversion():
    tenant = Tenant.objects.create(
        name="Konveksi Validasi",
        slug="konveksi-validasi",
        code="VAL",
    )
    kg = UOM.objects.create(
        tenant=tenant,
        code="KG",
        name="Kilogram",
        dimension=UOM.Dimension.MASS,
    )
    cm = UOM.objects.create(
        tenant=tenant,
        code="CM",
        name="Centimeter",
        dimension=UOM.Dimension.LENGTH,
    )

    material = Material.objects.create(
        tenant=tenant,
        code="MAT-KARET",
        name="Karet Lebar 5cm",
        purchase_uom=kg,
        usage_uom=cm,
        conversion_ratio=Decimal("2862"),
    )

    assert material.conversion_ratio == Decimal("2862")


@pytest.mark.django_db
def test_seed_dummy_reinhard_creates_data_and_is_idempotent(monkeypatch):
    set_dummy_env(monkeypatch)
    call_command("seed_dummy_konveksi")
    tenant = Tenant.objects.get(slug="dummy-konveksi")

    call_command("seed_dummy_reinhard", tenant_slug=tenant.slug)

    expected_material_codes = {
        "MAT-RJN",
        "MAT-PURING",
        "MAT-KARET",
        "MAT-SLETING-30",
        "MAT-SLETING-ROLL",
        "MAT-SLETING-KEPALA",
        "MAT-STOPER",
        "MAT-MATA-ITIK",
        "MAT-TALI",
        "MAT-BENANG",
        "MAT-KAPAS",
        "MAT-LBL-SLIP",
        "MAT-LBL-SATIN",
        "MAT-LBL-WOVEN",
        "MAT-LBL-UKURAN",
        "MAT-PLASTIK",
    }
    assert (
        set(
            Material.objects.filter(tenant=tenant, code__in=expected_material_codes)
            .order_by()
            .values_list("code", flat=True)
        )
        == expected_material_codes
    )

    karet = Material.objects.get(tenant=tenant, code="MAT-KARET")
    assert karet.purchase_uom.code == "KG"
    assert karet.usage_uom.code == "CM"
    assert karet.conversion_ratio == Decimal("2862.0000")
    assert karet.last_purchase_price == Decimal("37000.00")

    benang = Material.objects.get(tenant=tenant, code="MAT-BENANG")
    assert benang.purchase_uom.code == "PAK"
    assert benang.usage_uom.code == "M"
    assert benang.conversion_ratio == Decimal("27432.0000")
    assert benang.last_purchase_price == Decimal("80000.00")

    variants = ProductVariant.objects.filter(
        tenant=tenant,
        product_model__code="REINHARD",
        sku__startswith="REINHARD-0-",
    )
    assert variants.count() == 5
    assert (
        variants.get(sku="REINHARD-0-S").metadata["estimated_yield_per_rjn_roll"] == 60
    )

    boms = BOM.objects.filter(tenant=tenant, product_variant__in=variants)
    assert boms.count() == 5
    assert BOMItem.objects.filter(tenant=tenant, bom__in=boms).count() == 80
    bom_s = BOM.objects.get(tenant=tenant, product_variant__sku="REINHARD-0-S")
    assert BOMItem.objects.get(
        tenant=tenant,
        bom=bom_s,
        material__code="MAT-RJN",
    ).quantity == Decimal("155.0000")
    assert BOMItem.objects.get(
        tenant=tenant,
        bom=bom_s,
        material__code="MAT-BENANG",
    ).quantity == Decimal("77.0000")

    assert (
        PieceRate.objects.filter(
            tenant=tenant,
            product_model__code="REINHARD",
        ).count()
        == 5
    )

    po = PurchaseOrder.objects.get(tenant=tenant, po_number="REINHARD-PO-MATERIAL-001")
    assert po.total_amount == Decimal("3340800.00")
    rjn_line = PurchaseOrderLine.objects.get(
        tenant=tenant,
        purchase_order=po,
        material__code="MAT-RJN",
    )
    assert rjn_line.quantity == Decimal("1.0000")
    assert rjn_line.unit_price == Decimal("1900000.00")
    assert rjn_line.material.last_purchase_price == Decimal("1900000.00")
    assert (
        MaterialReceiptLine.objects.filter(
            tenant=tenant, receipt__purchase_order=po
        ).count()
        == 15
    )
    assert (
        MaterialLedger.objects.filter(
            tenant=tenant,
            idempotency_key__startswith="REINHARD-GR-MATERIAL-001:",
        ).count()
        == 15
    )

    assert (
        CostCategory.objects.filter(
            tenant=tenant,
            code__startswith="REINHARD-COST-",
        ).count()
        == 5
    )
    assert (
        Asset.objects.filter(tenant=tenant, category="Peralatan Konveksi").count() == 8
    )

    counts = {
        "materials": Material.objects.filter(
            tenant=tenant,
            code__in=expected_material_codes,
        ).count(),
        "variants": variants.count(),
        "bom_items": BOMItem.objects.filter(tenant=tenant, bom__in=boms).count(),
        "po_lines": PurchaseOrderLine.objects.filter(
            tenant=tenant, purchase_order=po
        ).count(),
        "receipt_lines": MaterialReceiptLine.objects.filter(
            tenant=tenant,
            receipt__purchase_order=po,
        ).count(),
        "ledger": MaterialLedger.objects.filter(
            tenant=tenant,
            idempotency_key__startswith="REINHARD-GR-MATERIAL-001:",
        ).count(),
        "cost_categories": CostCategory.objects.filter(
            tenant=tenant,
            code__startswith="REINHARD-COST-",
        ).count(),
        "assets": Asset.objects.filter(
            tenant=tenant, category="Peralatan Konveksi"
        ).count(),
    }

    call_command("seed_dummy_reinhard", tenant_slug=tenant.slug)

    assert (
        Material.objects.filter(tenant=tenant, code__in=expected_material_codes).count()
        == counts["materials"]
    )
    assert (
        ProductVariant.objects.filter(
            tenant=tenant,
            product_model__code="REINHARD",
            sku__startswith="REINHARD-0-",
        ).count()
        == counts["variants"]
    )
    assert (
        BOMItem.objects.filter(
            tenant=tenant,
            bom__product_variant__sku__startswith="REINHARD-0-",
        ).count()
        == counts["bom_items"]
    )
    assert (
        PurchaseOrderLine.objects.filter(tenant=tenant, purchase_order=po).count()
        == counts["po_lines"]
    )
    assert (
        MaterialReceiptLine.objects.filter(
            tenant=tenant,
            receipt__purchase_order=po,
        ).count()
        == counts["receipt_lines"]
    )
    assert (
        MaterialLedger.objects.filter(
            tenant=tenant,
            idempotency_key__startswith="REINHARD-GR-MATERIAL-001:",
        ).count()
        == counts["ledger"]
    )
    assert (
        CostCategory.objects.filter(
            tenant=tenant,
            code__startswith="REINHARD-COST-",
        ).count()
        == counts["cost_categories"]
    )
    assert (
        Asset.objects.filter(tenant=tenant, category="Peralatan Konveksi").count()
        == counts["assets"]
    )
