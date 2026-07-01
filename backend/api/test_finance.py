from decimal import Decimal

import pytest
from django.test import Client

from backend.accounting.models import AccountingPeriod
from backend.core.models import Membership, Tenant, User
from backend.finance.models import Asset, CostAllocation, SupplierInvoiceLine
from backend.inventory.models import PurchaseOrder, PurchaseOrderLine
from backend.masterdata.models import (
    CostCategory,
    Material,
    ProductModel,
    ProductVariant,
    Supplier,
    UOM,
)
from backend.production.models import ProductionCost, ProductionOrder


@pytest.mark.django_db
def test_petty_cash():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi F", slug="konveksi-f")
    user = User.objects.create_user(username="financeuser", password="testpassword")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.FINANCE)
    client.post(
        "/api/auth/login",
        {
            "username": "financeuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-f",
        },
        content_type="application/json",
    )

    resp = client.post(
        "/api/finance/petty-cash",
        data={
            "date": "2026-06-21",
            "type": "in",
            "amount": "1000000.00",
            "category": "Isi Ulang",
            "description": "Kas awal",
            "pic": "Budi",
        },
        content_type="application/json",
    )
    assert resp.status_code == 200
    resp_list = client.get("/api/finance/petty-cash")
    assert len(resp_list.json()) == 1


@pytest.mark.django_db
def test_assets():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi F", slug="konveksi-f")
    user = User.objects.create_user(username="financeuser", password="testpassword")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.FINANCE)
    client.post(
        "/api/auth/login",
        {
            "username": "financeuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-f",
        },
        content_type="application/json",
    )

    resp = client.post(
        "/api/finance/assets",
        data={
            "name": "Mesin Jahit Juki",
            "category": "Mesin Produksi",
            "acquisition_value": "5000000.00",
            "acquisition_date": "2026-01-01",
            "useful_life_months": 60,
            "depreciation_start_date": "2026-01-01",
        },
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert Asset.objects.filter(tenant_id=tenant.id).count() == 1


@pytest.mark.django_db
def test_cost_allocation_membuat_production_cost():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Alokasi", slug="konveksi-alokasi")
    user = User.objects.create_user(username="financealokasi", password="testpassword")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.FINANCE)
    period = AccountingPeriod.objects.create(
        tenant=tenant,
        name="Juni 2026",
        start_date="2026-06-01",
        end_date="2026-06-30",
    )
    category = CostCategory.objects.create(
        tenant=tenant,
        code="OH-LISTRIK",
        name="Listrik",
        allocation_basis=CostCategory.AllocationBasis.MANUAL,
    )
    product = ProductModel.objects.create(tenant=tenant, code="REINHARD", name="Jaket")
    variant = ProductVariant.objects.create(
        tenant=tenant,
        product_model=product,
        sku="REINHARD-0-M",
    )
    order = ProductionOrder.objects.create(
        tenant=tenant,
        order_number="SPK-ALOKASI",
        order_type=ProductionOrder.Type.FOR_STOCK,
        product_variant=variant,
        target_quantity=10,
    )
    client.post(
        "/api/auth/login",
        {
            "username": "financealokasi",
            "password": "testpassword",
            "tenant_slug": "konveksi-alokasi",
        },
        content_type="application/json",
    )

    response = client.post(
        "/api/finance/cost-allocations",
        data={
            "period_id": str(period.id),
            "category_id": str(category.id),
            "amount": "50000",
            "allocation_basis": "manual",
            "allocations": [
                {
                    "production_order_id": str(order.id),
                    "amount": "50000",
                }
            ],
            "reason": "Alokasi listrik Juni",
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    assert CostAllocation.objects.filter(tenant=tenant).count() == 1
    cost = ProductionCost.objects.get(tenant=tenant, production_order=order)
    assert cost.component == "Listrik"
    assert cost.amount == 50000


@pytest.mark.django_db
def test_supplier_invoice_lines_update_harga_beli_terakhir_material():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Invoice", slug="konveksi-invoice")
    user = User.objects.create_user(username="financeinvoice", password="testpassword")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.FINANCE)
    uom = UOM.objects.create(tenant=tenant, code="ROLL", name="Roll")
    material = Material.objects.create(
        tenant=tenant,
        code="MAT-ROLL",
        name="Kain Roll",
        purchase_uom=uom,
        usage_uom=uom,
        conversion_ratio=Decimal("1"),
        last_purchase_price=Decimal("100000"),
    )
    supplier = Supplier.objects.create(tenant=tenant, name="Supplier Roll")
    po = PurchaseOrder.objects.create(
        tenant=tenant,
        supplier=supplier,
        po_number="PUR-INV-001",
        status=PurchaseOrder.Status.PARTIAL_RECEIPT,
    )
    line = PurchaseOrderLine.objects.create(
        tenant=tenant,
        purchase_order=po,
        material=material,
        quantity=Decimal("5"),
        received_qty=Decimal("3"),
        unit_price=Decimal("110000"),
    )
    client.post(
        "/api/auth/login",
        {
            "username": "financeinvoice",
            "password": "testpassword",
            "tenant_slug": "konveksi-invoice",
        },
        content_type="application/json",
    )

    response = client.post(
        "/api/finance/supplier-invoices",
        data={
            "purchase_order_id": str(po.id),
            "invoice_number": "INV-SUP-001",
            "date": "2026-06-21",
            "lines": [
                {
                    "purchase_order_line_id": str(line.id),
                    "quantity": "2",
                    "unit_price": "125000",
                }
            ],
        },
        content_type="application/json",
    )

    assert response.status_code == 200
    assert response.json()["total_amount"] == "250000.00"
    assert SupplierInvoiceLine.objects.filter(tenant=tenant).count() == 1
    line.refresh_from_db()
    material.refresh_from_db()
    assert line.invoiced_qty == Decimal("2")
    assert material.last_purchase_price == Decimal("125000")


@pytest.mark.django_db
def test_supplier_invoice_menolak_baris_di_luar_po_dan_qty_lebih_diterima():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi Invoice 2", slug="konveksi-invoice-2")
    user = User.objects.create_user(username="financeinvoice2", password="testpassword")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.FINANCE)
    uom = UOM.objects.create(tenant=tenant, code="PCS", name="Pieces")
    material = Material.objects.create(
        tenant=tenant,
        code="MAT-PCS",
        name="Label",
        purchase_uom=uom,
        usage_uom=uom,
        conversion_ratio=Decimal("1"),
    )
    supplier = Supplier.objects.create(tenant=tenant, name="Supplier Label")
    po = PurchaseOrder.objects.create(
        tenant=tenant,
        supplier=supplier,
        po_number="PUR-INV-002",
        status=PurchaseOrder.Status.PARTIAL_RECEIPT,
    )
    other_po = PurchaseOrder.objects.create(
        tenant=tenant,
        supplier=supplier,
        po_number="PUR-INV-003",
        status=PurchaseOrder.Status.PARTIAL_RECEIPT,
    )
    line = PurchaseOrderLine.objects.create(
        tenant=tenant,
        purchase_order=po,
        material=material,
        quantity=Decimal("10"),
        received_qty=Decimal("2"),
        unit_price=Decimal("100"),
    )
    other_line = PurchaseOrderLine.objects.create(
        tenant=tenant,
        purchase_order=other_po,
        material=material,
        quantity=Decimal("10"),
        received_qty=Decimal("2"),
        unit_price=Decimal("100"),
    )
    client.post(
        "/api/auth/login",
        {
            "username": "financeinvoice2",
            "password": "testpassword",
            "tenant_slug": "konveksi-invoice-2",
        },
        content_type="application/json",
    )

    wrong_po_response = client.post(
        "/api/finance/supplier-invoices",
        data={
            "purchase_order_id": str(po.id),
            "invoice_number": "INV-SUP-002",
            "date": "2026-06-21",
            "lines": [
                {
                    "purchase_order_line_id": str(other_line.id),
                    "quantity": "1",
                    "unit_price": "100",
                }
            ],
        },
        content_type="application/json",
    )
    assert wrong_po_response.status_code == 422

    too_many_response = client.post(
        "/api/finance/supplier-invoices",
        data={
            "purchase_order_id": str(po.id),
            "invoice_number": "INV-SUP-003",
            "date": "2026-06-21",
            "lines": [
                {
                    "purchase_order_line_id": str(line.id),
                    "quantity": "3",
                    "unit_price": "100",
                }
            ],
        },
        content_type="application/json",
    )
    assert too_many_response.status_code == 422
