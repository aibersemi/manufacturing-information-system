# Fixture pytest sengaja diinjeksikan melalui nama argumen test.
# pylint: disable=redefined-outer-name,unused-argument

import pytest
from django.test import Client
from decimal import Decimal

from backend.core.models import Membership, Tenant, User
from backend.inventory.models import (
    MaterialLedger,
    PurchaseOrder,
    PurchaseOrderLine,
)
from backend.masterdata.models import UOM, Material, Supplier


@pytest.fixture
def setup_tenants():
    # Buat dua konveksi
    t1 = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    t2 = Tenant.objects.create(name="Konveksi B", slug="konveksi-b")

    # Buat user A dan B
    u1 = User.objects.create_user(username="user_a", password="password")
    u2 = User.objects.create_user(username="user_b", password="password")
    u1.memberships.create(tenant=t1, role=Membership.Role.KEPALA_KONVEKSI)
    u2.memberships.create(tenant=t2, role=Membership.Role.KEPALA_KONVEKSI)

    # UOM
    uom_kg_1 = UOM.objects.create(tenant=t1, code="KG", name="Kilogram")
    uom_kg_2 = UOM.objects.create(tenant=t2, code="KG", name="Kilogram")

    # Buat material dan supplier di Tenant A
    m1 = Material.objects.create(
        tenant=t1,
        code="KAIN-A",
        name="Kain A",
        purchase_uom=uom_kg_1,
        usage_uom=uom_kg_1,
        conversion_ratio=1.0,
    )
    s1 = Supplier.objects.create(tenant=t1, name="Pemasok A")

    # Buat transaksi di Tenant A
    MaterialLedger.objects.create(
        tenant=t1,
        material=m1,
        transaction_type="receipt",
        quantity=100.0,
        reference_document="INV-001",
    )
    po = PurchaseOrder.objects.create(tenant=t1, supplier=s1, po_number="PO-INV-001")
    PurchaseOrderLine.objects.create(
        tenant=t1, purchase_order=po, material=m1, quantity=50.0, unit_price=10000
    )

    # Buat material dan supplier di Tenant B
    m2 = Material.objects.create(
        tenant=t2,
        code="KAIN-B",
        name="Kain B",
        purchase_uom=uom_kg_2,
        usage_uom=uom_kg_2,
        conversion_ratio=1.0,
    )
    s2 = Supplier.objects.create(tenant=t2, name="Pemasok B")

    # Buat transaksi di Tenant B
    MaterialLedger.objects.create(
        tenant=t2,
        material=m2,
        transaction_type="receipt",
        quantity=200.0,
        reference_document="INV-002",
    )
    PurchaseOrder.objects.create(tenant=t2, supplier=s2, po_number="PO-INV-002")

    return {"t1": t1, "t2": t2, "u1": u1, "u2": u2}


@pytest.mark.django_db
def test_inventory_isolation(setup_tenants):
    client = Client()

    # Login User A (Tenant A)
    client.post(
        "/api/auth/login",
        {"username": "user_a", "password": "password", "tenant_slug": "konveksi-a"},
        content_type="application/json",
    )

    # Cek Material Ledger Tenant A
    res = client.get("/api/inventory/material-ledger")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["quantity"] == "100.0000"

    # Cek Purchase Order Tenant A
    res_po = client.get("/api/inventory/purchases")
    assert res_po.status_code == 200
    po_data = res_po.json()
    assert len(po_data) == 1
    assert po_data[0]["po_number"] == "PO-INV-001"

    # Login User B (Tenant B)
    client.post(
        "/api/auth/login",
        {"username": "user_b", "password": "password", "tenant_slug": "konveksi-b"},
        content_type="application/json",
    )

    # Cek Material Ledger Tenant B
    res2 = client.get("/api/inventory/material-ledger")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2) == 1
    assert data2[0]["quantity"] == "200.0000"

    # Cek Purchase Order Tenant B
    res_po2 = client.get("/api/inventory/purchases")
    assert res_po2.status_code == 200
    po_data2 = res_po2.json()
    assert len(po_data2) == 1
    assert po_data2[0]["po_number"] == "PO-INV-002"


@pytest.mark.django_db
def test_purchase_order_manual_mematuhi_moq_dan_kelipatan():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi MOQ", slug="konveksi-moq")
    user = User.objects.create_user(username="kepala-moq", password="password")
    Membership.objects.create(
        user=user, tenant=tenant, role=Membership.Role.KEPALA_KONVEKSI
    )
    purchase_uom = UOM.objects.create(tenant=tenant, code="ROLL", name="Roll")
    usage_uom = UOM.objects.create(tenant=tenant, code="CM", name="Centimeter")
    material = Material.objects.create(
        tenant=tenant,
        code="MAT-ROLL",
        name="Kain Roll",
        purchase_uom=purchase_uom,
        usage_uom=usage_uom,
        conversion_ratio=Decimal("9144"),
        moq=Decimal("2"),
        purchase_multiple=Decimal("2"),
    )
    supplier = Supplier.objects.create(tenant=tenant, name="Supplier Roll")
    client.post(
        "/api/auth/login",
        {
            "username": "kepala-moq",
            "password": "password",
            "tenant_slug": "konveksi-moq",
        },
        content_type="application/json",
    )

    rejected = client.post(
        "/api/inventory/purchases",
        data={
            "supplier_id": str(supplier.id),
            "lines": [
                {
                    "material_id": str(material.id),
                    "quantity": "3",
                    "unit_price": "100000",
                }
            ],
        },
        content_type="application/json",
    )
    assert rejected.status_code == 422

    accepted = client.post(
        "/api/inventory/purchases",
        data={
            "supplier_id": str(supplier.id),
            "lines": [
                {
                    "material_id": str(material.id),
                    "quantity": "4",
                    "unit_price": "100000",
                }
            ],
        },
        content_type="application/json",
    )
    assert accepted.status_code == 200
