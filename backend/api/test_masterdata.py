from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import Client

from backend.core.models import Membership, Tenant, User
from backend.inventory.models import MaterialLedger
from backend.masterdata.models import (
    BOM,
    BOMItem,
    Customer,
    Material,
    PieceRate,
    ProductModel,
    ProductVariant,
    Routing,
    RoutingStage,
    Supplier,
    UOM,
)
from backend.production.models import JobPacket, ProductionOrder
from backend.tests.test_seed_dummy_konveksi_command import set_dummy_env


def _login(client: Client, username: str, tenant_slug: str, password: str = "testpassword"):
    return client.post(
        "/api/auth/login",
        {
            "username": username,
            "password": password,
            "tenant_slug": tenant_slug,
        },
        content_type="application/json",
    )


@pytest.mark.django_db
def test_masterdata_tenant_isolation():
    client = Client()

    tenant_a = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    tenant_b = Tenant.objects.create(name="Konveksi B", slug="konveksi-b")

    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant_a, role=Membership.Role.KEPALA_KONVEKSI
    )

    # Login as User A to Tenant A
    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    # Create Customer for Tenant A via API
    response = client.post(
        "/api/masterdata/customers",
        {
            "name": "Customer Konveksi A",
            "phone": "0811",
            "email": "",
            "address": "",
            "is_active": True,
        },
        content_type="application/json",
    )
    assert response.status_code == 200

    # Create Customer for Tenant B directly
    Customer.objects.create(tenant=tenant_b, name="Customer Konveksi B", phone="0822")

    # List Customers via API, should ONLY see Customer Konveksi A
    response = client.get("/api/masterdata/customers")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Customer Konveksi A"


@pytest.mark.django_db
def test_piece_rates_list_only_latest_active_version_per_stage():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Tarif", slug="konveksi-tarif")
    user = User.objects.create_user(username="tarifuser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    product_model = ProductModel.objects.create(
        tenant=tenant, code="JKT", name="Jaket"
    )
    PieceRate.objects.create(
        tenant=tenant,
        product_model=product_model,
        stage_name="Jahit",
        rate_amount=Decimal("1000"),
        effective_date="2026-06-22",
    )
    latest = PieceRate.objects.create(
        tenant=tenant,
        product_model=product_model,
        stage_name="Jahit",
        rate_amount=Decimal("1500"),
        effective_date="2026-06-26",
    )
    PieceRate.objects.create(
        tenant=tenant,
        product_model=product_model,
        stage_name="Jahit",
        rate_amount=Decimal("2000"),
        effective_date="2026-06-27",
        is_active=False,
    )

    client.post(
        "/api/auth/login",
        {
            "username": "tarifuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-tarif",
        },
        content_type="application/json",
    )

    response = client.get("/api/masterdata/piece-rates")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == str(latest.id)
    assert data[0]["effective_date"] == "2026-06-26"
    assert data[0]["rate_amount"] == "1500.00"


@pytest.mark.django_db
def test_piece_rate_create_rejects_duplicate_effective_date():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Tarif", slug="konveksi-tarif")
    user = User.objects.create_user(username="tarifuser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    product_model = ProductModel.objects.create(
        tenant=tenant, code="JKT", name="Jaket"
    )
    client.post(
        "/api/auth/login",
        {
            "username": "tarifuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-tarif",
        },
        content_type="application/json",
    )
    payload = {
        "product_model_id": str(product_model.id),
        "stage_name": "Jahit",
        "rate_amount": "1500",
        "effective_date": "2026-06-26",
        "operator_id": None,
        "location": "",
        "operator_status": "",
        "change_reason": "Initial setup",
    }

    response = client.post(
        "/api/masterdata/piece-rates", payload, content_type="application/json"
    )
    duplicate_response = client.post(
        "/api/masterdata/piece-rates",
        {**payload, "rate_amount": "2000"},
        content_type="application/json",
    )

    assert response.status_code == 200
    assert duplicate_response.status_code == 409
    assert PieceRate.objects.filter(tenant=tenant, product_model=product_model).count() == 1


@pytest.mark.django_db
def test_customer_and_supplier_can_update_and_delete_in_active_tenant():
    client = Client()

    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    customer = Customer.objects.create(tenant=tenant, name="Pelanggan Lama")
    supplier = Supplier.objects.create(tenant=tenant, name="Pemasok Lama")

    response = client.put(
        f"/api/masterdata/customers/{customer.id}",
        {
            "name": "Pelanggan Baru",
            "phone": "0811",
            "email": "",
            "address": "",
            "is_active": False,
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    customer.refresh_from_db()
    assert customer.name == "Pelanggan Baru"
    assert customer.is_active is False

    response = client.put(
        f"/api/masterdata/suppliers/{supplier.id}",
        {
            "name": "Pemasok Baru",
            "contact_person": "",
            "phone": "0822",
            "email": "",
            "address": "",
            "is_active": False,
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    supplier.refresh_from_db()
    assert supplier.name == "Pemasok Baru"
    assert supplier.is_active is False

    response = client.delete(f"/api/masterdata/customers/{customer.id}")
    assert response.status_code == 403
    assert Customer.objects.filter(id=customer.id).exists()

    User.objects.create_superuser(username="master-super", password="testpassword")
    super_client = Client()
    super_client.post(
        "/api/auth/login",
        {
            "username": "master-super",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    response = super_client.delete(f"/api/masterdata/customers/{customer.id}")
    assert response.status_code == 200
    assert not Customer.objects.filter(id=customer.id).exists()

    response = super_client.delete(f"/api/masterdata/suppliers/{supplier.id}")
    assert response.status_code == 200
    assert not Supplier.objects.filter(id=supplier.id).exists()


@pytest.mark.django_db
def test_material_create_auto_generates_code_and_merges_duplicate_fields():
    client = Client()

    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    purchase_uom = UOM.objects.create(tenant=tenant, code="PAK", name="Pak")
    usage_uom = UOM.objects.create(tenant=tenant, code="PCS", name="Pieces")
    Material.objects.create(
        tenant=tenant,
        code="MAT-000001",
        name="Material Lama",
        purchase_uom=purchase_uom,
        usage_uom=usage_uom,
        conversion_ratio=Decimal("1"),
        package_quantity=Decimal("1"),
        moq=Decimal("1"),
        purchase_multiple=Decimal("1"),
    )

    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    response = client.post(
        "/api/masterdata/materials",
        {
            "name": "Material Baru",
            "purchase_uom_id": str(purchase_uom.id),
            "usage_uom_id": str(usage_uom.id),
            "moq": "12",
            "package_quantity": "500",
            "shrinkage_percent": "2.5",
            "last_purchase_price": "15000",
            "is_active": True,
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["code"] == "MAT-000002"
    assert data["purchase_uom_code"] == "PAK"
    assert data["usage_uom_code"] == "PCS"

    material = Material.objects.get(id=data["id"])
    assert material.code == "MAT-000002"
    assert material.moq == Decimal("12")
    assert material.purchase_multiple == Decimal("1")
    assert material.package_quantity == Decimal("500")
    assert material.conversion_ratio == Decimal("500")
    assert material.last_purchase_price == Decimal("15000")

    list_response = client.get("/api/masterdata/materials")
    assert list_response.status_code == 200
    listed_by_id = {item["id"]: item for item in list_response.json()}
    assert listed_by_id[data["id"]]["purchase_uom_code"] == "PAK"
    assert listed_by_id[data["id"]]["usage_uom_code"] == "PCS"


@pytest.mark.django_db
def test_material_update_preserves_code_and_merges_duplicate_fields():
    client = Client()

    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    purchase_uom = UOM.objects.create(tenant=tenant, code="ROLL", name="Roll")
    usage_uom = UOM.objects.create(tenant=tenant, code="CM", name="Centimeter")
    material = Material.objects.create(
        tenant=tenant,
        code="MAT-KODE-LAMA",
        name="Material Lama",
        purchase_uom=purchase_uom,
        usage_uom=usage_uom,
        conversion_ratio=Decimal("1"),
        package_quantity=Decimal("1"),
        moq=Decimal("1"),
        purchase_multiple=Decimal("1"),
    )

    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    response = client.put(
        f"/api/masterdata/materials/{material.id}",
        {
            "code": "MAT-KODE-BARU",
            "name": "Material Update",
            "purchase_uom_id": str(purchase_uom.id),
            "usage_uom_id": str(usage_uom.id),
            "moq": "24",
            "purchase_multiple": "6",
            "package_quantity": "250",
            "shrinkage_percent": "1",
            "last_purchase_price": "17500",
            "is_active": False,
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["purchase_uom_code"] == "ROLL"
    assert data["usage_uom_code"] == "CM"
    material.refresh_from_db()
    assert material.code == "MAT-KODE-LAMA"
    assert material.name == "Material Update"
    assert material.moq == Decimal("24")
    assert material.purchase_multiple == Decimal("6")
    assert material.package_quantity == Decimal("250")
    assert material.conversion_ratio == Decimal("250")
    assert material.last_purchase_price == Decimal("17500")
    assert material.is_active is False


@pytest.mark.django_db
def test_material_create_rejects_invalid_business_values():
    client = Client()

    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    purchase_uom = UOM.objects.create(tenant=tenant, code="ROLL", name="Roll")
    usage_uom = UOM.objects.create(tenant=tenant, code="CM", name="Centimeter")
    inactive_supplier = Supplier.objects.create(
        tenant=tenant, name="Supplier Nonaktif", is_active=False
    )

    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    base_payload = {
        "name": "Material Baru",
        "purchase_uom_id": str(purchase_uom.id),
        "usage_uom_id": str(usage_uom.id),
        "moq": "1",
        "purchase_multiple": "1",
        "package_quantity": "100",
        "shrinkage_percent": "0",
        "is_active": True,
    }
    cases = [
        ({"name": "   "}, "Nama material"),
        ({"moq": "0"}, "Minimal pembelian"),
        ({"purchase_multiple": "0"}, "Kelipatan beli"),
        ({"package_quantity": "0"}, "Isi kemasan"),
        ({"shrinkage_percent": "101"}, "maksimal 100"),
        ({"last_purchase_price": "-1"}, "Harga beli terakhir"),
        (
            {"usage_uom_id": str(purchase_uom.id), "package_quantity": "2"},
            "satuan pembelian sama",
        ),
        ({"default_supplier_id": str(inactive_supplier.id)}, "Supplier default"),
    ]

    for override, expected_detail in cases:
        response = client.post(
            "/api/masterdata/materials",
            {**base_payload, **override},
            content_type="application/json",
        )

        assert response.status_code == 422
        assert expected_detail in str(response.json()["detail"])


@pytest.mark.django_db
def test_material_create_rejects_duplicate_name_case_insensitive():
    client = Client()

    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    purchase_uom = UOM.objects.create(tenant=tenant, code="ROLL", name="Roll")
    usage_uom = UOM.objects.create(tenant=tenant, code="CM", name="Centimeter")
    Material.objects.create(
        tenant=tenant,
        code="MAT-000001",
        name="Bahan Kain RJN",
        purchase_uom=purchase_uom,
        usage_uom=usage_uom,
        conversion_ratio=Decimal("9144"),
        package_quantity=Decimal("9144"),
        moq=Decimal("1"),
        purchase_multiple=Decimal("1"),
    )

    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    response = client.post(
        "/api/masterdata/materials",
        {
            "name": " bahan kain rjn ",
            "purchase_uom_id": str(purchase_uom.id),
            "usage_uom_id": str(usage_uom.id),
            "moq": "1",
            "purchase_multiple": "1",
            "package_quantity": "9144",
            "shrinkage_percent": "0",
            "is_active": True,
        },
        content_type="application/json",
    )

    assert response.status_code == 422
    assert "Nama material sudah digunakan" in str(response.json()["detail"])


@pytest.mark.django_db
def test_material_update_rejects_conversion_change_after_stock_usage():
    client = Client()

    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    purchase_uom = UOM.objects.create(tenant=tenant, code="ROLL", name="Roll")
    usage_uom = UOM.objects.create(tenant=tenant, code="CM", name="Centimeter")
    material = Material.objects.create(
        tenant=tenant,
        code="MAT-000001",
        name="Bahan Kain RJN",
        purchase_uom=purchase_uom,
        usage_uom=usage_uom,
        conversion_ratio=Decimal("9144"),
        package_quantity=Decimal("9144"),
        moq=Decimal("1"),
        purchase_multiple=Decimal("1"),
    )
    MaterialLedger.objects.create(
        tenant=tenant,
        material=material,
        transaction_type=MaterialLedger.TransactionType.RECEIPT,
        quantity=Decimal("9144"),
        reference_document="TEST-RCV",
    )

    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    response = client.put(
        f"/api/masterdata/materials/{material.id}",
        {
            "name": "Bahan Kain RJN",
            "purchase_uom_id": str(purchase_uom.id),
            "usage_uom_id": str(usage_uom.id),
            "moq": "1",
            "purchase_multiple": "1",
            "package_quantity": "9000",
            "shrinkage_percent": "0",
            "is_active": True,
        },
        content_type="application/json",
    )

    assert response.status_code == 422
    assert "tidak dapat diubah" in str(response.json()["detail"])


@pytest.mark.django_db
def test_product_variant_sku_is_generated_from_model_color_and_size():
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    product = ProductModel.objects.create(
        tenant=tenant, code="jaket reinhard", name="Jaket Reinhard"
    )

    variant = ProductVariant.objects.create(
        tenant=tenant,
        product_model=product,
        color="Merah Marun",
        size="L",
    )

    product.refresh_from_db()
    assert product.code == "JAKET_REINHARD"
    assert variant.sku == "JAKET_REINHARD-MERAH_MARUN-L"


@pytest.mark.django_db
def test_product_variant_rejects_invalid_sku_segment():
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    product = ProductModel.objects.create(
        tenant=tenant, code="REINHARD", name="Jaket Reinhard"
    )

    with pytest.raises(ValidationError, match="Segmen SKU"):
        ProductVariant.objects.create(
            tenant=tenant,
            product_model=product,
            color="Merah/Biru",
            size="L",
        )


@pytest.mark.django_db
def test_product_model_code_cannot_change_after_variant_exists():
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    product = ProductModel.objects.create(
        tenant=tenant, code="REINHARD", name="Jaket Reinhard"
    )
    ProductVariant.objects.create(tenant=tenant, product_model=product, size="L")

    product.code = "JAKET_REINHARD"

    with pytest.raises(ValidationError, match="tidak dapat diubah"):
        product.save()


@pytest.mark.django_db
def test_product_variant_api_generates_sku_without_sku_payload():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    product = ProductModel.objects.create(
        tenant=tenant, code="REINHARD", name="Jaket Reinhard"
    )
    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    response = client.post(
        "/api/masterdata/product-variants",
        {
            "product_model_id": str(product.id),
            "color": "",
            "size": "L",
            "metadata": {},
            "is_active": True,
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    data = response.json()
    assert data["sku"] == "REINHARD-0-L"
    assert ProductVariant.objects.get(id=data["id"]).sku == "REINHARD-0-L"


@pytest.mark.django_db
def test_product_variant_api_rejects_invalid_and_duplicate_generated_sku():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="masteruser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    product = ProductModel.objects.create(
        tenant=tenant, code="REINHARD", name="Jaket Reinhard"
    )
    ProductVariant.objects.create(tenant=tenant, product_model=product, size="L")
    client.post(
        "/api/auth/login",
        {
            "username": "masteruser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    invalid_response = client.post(
        "/api/masterdata/product-variants",
        {
            "product_model_id": str(product.id),
            "color": "Merah/Biru",
            "size": "M",
            "metadata": {},
            "is_active": True,
        },
        content_type="application/json",
    )
    duplicate_response = client.post(
        "/api/masterdata/product-variants",
        {
            "product_model_id": str(product.id),
            "color": "",
            "size": "L",
            "metadata": {},
            "is_active": True,
        },
        content_type="application/json",
    )

    assert invalid_response.status_code == 422
    assert duplicate_response.status_code == 422


@pytest.mark.django_db
def test_bom_detail_returns_reinhard_formula_items(monkeypatch):
    set_dummy_env(monkeypatch)
    call_command("seed_dummy_konveksi")
    tenant = Tenant.objects.get(slug="dummy-konveksi")
    call_command("seed_dummy_reinhard", tenant_slug=tenant.slug)

    client = Client()
    client.post(
        "/api/auth/login",
        {
            "username": "kepala",
            "password": "pass123",
            "tenant_slug": tenant.slug,
        },
        content_type="application/json",
    )

    bom = BOM.objects.get(tenant=tenant, product_variant__sku="REINHARD-0-L")
    response = client.get(f"/api/masterdata/boms/{bom.id}")

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == str(bom.id)
    assert data["version"] == 1
    assert data["is_active"] is True
    assert data["product_variant"]["sku"] == "REINHARD-0-L"
    assert data["product_variant"]["size"] == "L"
    assert data["product_variant"]["metadata"]["estimated_yield_per_rjn_roll"] == 57
    assert len(data["items"]) == 16

    items_by_code = {item["material_code"]: item for item in data["items"]}
    assert items_by_code["MAT-RJN"]["quantity"] == "170.0000"
    assert items_by_code["MAT-RJN"]["usage_uom_code"] == "CM"
    assert items_by_code["MAT-PURING"]["quantity"] == "134.0000"
    assert items_by_code["MAT-PURING"]["usage_uom_code"] == "CM"
    assert items_by_code["MAT-BENANG"]["quantity"] == "77.0000"
    assert items_by_code["MAT-BENANG"]["usage_uom_code"] == "M"


@pytest.mark.django_db
def test_bom_detail_is_tenant_scoped(monkeypatch):
    set_dummy_env(monkeypatch)
    call_command("seed_dummy_konveksi")
    tenant = Tenant.objects.get(slug="dummy-konveksi")
    call_command("seed_dummy_reinhard", tenant_slug=tenant.slug)
    bom = BOM.objects.get(tenant=tenant, product_variant__sku="REINHARD-0-L")

    other_tenant = Tenant.objects.create(
        name="Konveksi Lain",
        slug="konveksi-lain",
        code="LAIN",
    )
    user = User.objects.create_user(username="kepala-lain", password="testpassword")
    Membership.objects.create(
        user=user,
        tenant=other_tenant,
        role=Membership.Role.KEPALA_KONVEKSI,
    )
    client = Client()
    client.post(
        "/api/auth/login",
        {
            "username": "kepala-lain",
            "password": "testpassword",
            "tenant_slug": other_tenant.slug,
        },
        content_type="application/json",
    )

    response = client.get(f"/api/masterdata/boms/{bom.id}")

    assert response.status_code == 404


@pytest.mark.django_db
def test_bom_item_crud_updates_formula_without_recreating_bom(monkeypatch):
    set_dummy_env(monkeypatch)
    call_command("seed_dummy_konveksi")
    tenant = Tenant.objects.get(slug="dummy-konveksi")
    call_command("seed_dummy_reinhard", tenant_slug=tenant.slug)

    user = User.objects.create_user(username="formula-admin", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.SUPER_ADMIN
    )
    client = Client()
    client.post(
        "/api/auth/login",
        {
            "username": "formula-admin",
            "password": "testpassword",
            "tenant_slug": tenant.slug,
        },
        content_type="application/json",
    )

    bom = BOM.objects.get(tenant=tenant, product_variant__sku="REINHARD-0-L")
    material = Material.objects.create(
        tenant=tenant,
        code="MAT-CRUD",
        name="Material CRUD",
        purchase_uom=UOM.objects.get(tenant=tenant, code="PAK"),
        usage_uom=UOM.objects.get(tenant=tenant, code="PCS"),
        conversion_ratio=Decimal("10"),
    )

    create_response = client.post(
        f"/api/masterdata/boms/{bom.id}/items",
        {"material_id": str(material.id), "quantity": "2.5"},
        content_type="application/json",
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["material_code"] == "MAT-CRUD"
    assert created["quantity"] == "2.5000"
    assert created["purchase_uom_code"] == "PAK"
    assert created["usage_uom_code"] == "PCS"
    assert created["conversion_ratio"] == "10.0000"

    update_response = client.put(
        f"/api/masterdata/boms/{bom.id}/items/{created['id']}",
        {"quantity": "3.75"},
        content_type="application/json",
    )

    assert update_response.status_code == 200
    assert update_response.json()["quantity"] == "3.7500"
    assert BOMItem.objects.get(id=created["id"]).quantity == Decimal("3.7500")

    delete_response = client.delete(
        f"/api/masterdata/boms/{bom.id}/items/{created['id']}"
    )

    assert delete_response.status_code == 200
    assert not BOMItem.objects.filter(id=created["id"]).exists()


@pytest.mark.django_db
def test_bom_item_create_rejects_material_from_other_tenant(monkeypatch):
    set_dummy_env(monkeypatch)
    call_command("seed_dummy_konveksi")
    tenant = Tenant.objects.get(slug="dummy-konveksi")
    call_command("seed_dummy_reinhard", tenant_slug=tenant.slug)

    other_tenant = Tenant.objects.create(
        name="Konveksi Lain",
        slug="konveksi-lain",
        code="LAIN",
    )
    uom = UOM.objects.create(tenant=other_tenant, code="PCS", name="Pieces")
    other_material = Material.objects.create(
        tenant=other_tenant,
        code="MAT-LAIN",
        name="Material Lain",
        purchase_uom=uom,
        usage_uom=uom,
        conversion_ratio=Decimal("1"),
    )

    client = Client()
    client.post(
        "/api/auth/login",
        {
            "username": "kepala",
            "password": "pass123",
            "tenant_slug": tenant.slug,
        },
        content_type="application/json",
    )
    bom = BOM.objects.get(tenant=tenant, product_variant__sku="REINHARD-0-L")

    response = client.post(
        f"/api/masterdata/boms/{bom.id}/items",
        {"material_id": str(other_material.id), "quantity": "1"},
        content_type="application/json",
    )

    assert response.status_code == 404


@pytest.mark.django_db
def test_routing_stage_crud_and_detail_response():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Routing", slug="konveksi-routing")
    user = User.objects.create_user(username="routinguser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    model = ProductModel.objects.create(tenant=tenant, code="KMEJA", name="Kemeja")
    routing = Routing.objects.create(
        tenant=tenant,
        product_model=model,
        version=1,
        effective_date=date(2026, 6, 27),
    )
    assert _login(client, "routinguser", "konveksi-routing").status_code == 200

    create_response = client.post(
        f"/api/masterdata/routings/{routing.id}/stages",
        {
            "sequence": 1,
            "stage_name": " Potong ",
            "transition_rule": {"mode": "strict_sequence"},
            "requires_qc": False,
        },
        content_type="application/json",
    )

    assert create_response.status_code == 200
    stage_data = create_response.json()
    assert stage_data["stage_name"] == "Potong"
    assert stage_data["transition_rule"] == {"mode": "strict_sequence"}

    duplicate_sequence = client.post(
        f"/api/masterdata/routings/{routing.id}/stages",
        {
            "sequence": 1,
            "stage_name": "Jahit",
            "transition_rule": {"mode": "any_to_any"},
            "requires_qc": False,
        },
        content_type="application/json",
    )
    assert duplicate_sequence.status_code == 409

    invalid_rule = client.put(
        f"/api/masterdata/routings/{routing.id}/stages/{stage_data['id']}",
        {
            "sequence": 2,
            "stage_name": "Jahit",
            "transition_rule": {"mode": "lompat"},
            "requires_qc": True,
        },
        content_type="application/json",
    )
    assert invalid_rule.status_code == 422

    update_response = client.put(
        f"/api/masterdata/routings/{routing.id}/stages/{stage_data['id']}",
        {
            "sequence": 2,
            "stage_name": "Jahit",
            "transition_rule": {"mode": "any_to_any"},
            "requires_qc": True,
        },
        content_type="application/json",
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["sequence"] == 2
    assert updated["requires_qc"] is True

    detail_response = client.get(f"/api/masterdata/routings/{routing.id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["stages"][0]["stage_name"] == "Jahit"

    super_user = User.objects.create_superuser(
        username="routing-super", password="testpassword"
    )
    super_client = Client()
    assert _login(super_client, super_user.username, "konveksi-routing").status_code == 200
    delete_response = super_client.delete(
        f"/api/masterdata/routings/{routing.id}/stages/{stage_data['id']}"
    )
    assert delete_response.status_code == 200
    assert not RoutingStage.objects.filter(id=stage_data["id"]).exists()


@pytest.mark.django_db
def test_routing_duplicate_copies_stages_and_rejects_existing_version():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Routing", slug="konveksi-routing")
    user = User.objects.create_user(username="routinguser", password="testpassword")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    model = ProductModel.objects.create(tenant=tenant, code="KMEJA", name="Kemeja")
    routing = Routing.objects.create(
        tenant=tenant,
        product_model=model,
        version=1,
        effective_date=date(2026, 6, 27),
    )
    RoutingStage.objects.create(
        tenant=tenant,
        routing=routing,
        sequence=1,
        stage_name="Potong",
        transition_rule="strict_sequence",
    )
    RoutingStage.objects.create(
        tenant=tenant,
        routing=routing,
        sequence=2,
        stage_name="QC",
        transition_rule={"mode": "any_to_any"},
        requires_qc=True,
    )
    assert _login(client, "routinguser", "konveksi-routing").status_code == 200

    duplicate_response = client.post(
        f"/api/masterdata/routings/{routing.id}/duplicate",
        {
            "version": 2,
            "effective_date": "2026-07-01",
            "is_active": True,
        },
        content_type="application/json",
    )

    assert duplicate_response.status_code == 200
    data = duplicate_response.json()
    assert data["version"] == 2
    assert len(data["stages"]) == 2
    assert data["stages"][0]["transition_rule"] == {"mode": "strict_sequence"}
    assert Routing.objects.filter(tenant=tenant, product_model=model).count() == 2

    conflict_response = client.post(
        f"/api/masterdata/routings/{routing.id}/duplicate",
        {
            "version": 2,
            "effective_date": "2026-07-02",
            "is_active": True,
        },
        content_type="application/json",
    )
    assert conflict_response.status_code == 409


@pytest.mark.django_db
def test_routing_stage_delete_rejects_stage_used_by_job_packet():
    tenant = Tenant.objects.create(name="Konveksi Routing", slug="konveksi-routing")
    model = ProductModel.objects.create(tenant=tenant, code="KMEJA", name="Kemeja")
    variant = ProductVariant.objects.create(
        tenant=tenant, product_model=model, color="Biru", size="L"
    )
    routing = Routing.objects.create(
        tenant=tenant,
        product_model=model,
        version=1,
        effective_date=date(2026, 6, 27),
    )
    stage = RoutingStage.objects.create(
        tenant=tenant, routing=routing, sequence=1, stage_name="Potong"
    )
    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number="SPK-ROUTE-1",
        order_type=ProductionOrder.Type.FOR_STOCK,
        product_variant=variant,
        target_quantity=10,
    )
    JobPacket.objects.create(
        tenant=tenant,
        production_order=order,
        packet_number="PKT-ROUTE-1",
        quantity=10,
        current_stage=stage,
    )
    User.objects.create_superuser(username="routing-super", password="testpassword")
    client = Client()
    assert _login(client, "routing-super", "konveksi-routing").status_code == 200

    response = client.delete(f"/api/masterdata/routings/{routing.id}/stages/{stage.id}")

    assert response.status_code == 409
    assert RoutingStage.objects.filter(id=stage.id).exists()
