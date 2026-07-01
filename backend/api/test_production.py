# Django TestCase menginisialisasi data test melalui setUp.
# pylint: disable=attribute-defined-outside-init

from datetime import date

import pytest
from django.test import Client

from backend.core.models import Membership, Tenant, User
from backend.masterdata.models import (
    BOM,
    BOMItem,
    Material,
    ProductModel,
    ProductVariant,
    UOM,
)
from backend.production.models import MaterialRequirement, ProductionOrder


@pytest.mark.django_db
class TestProductionOrderIsolation:
    def setup_method(self):
        self.tenant1 = Tenant.objects.create(name="Konveksi A", slug="konveksia")
        self.tenant2 = Tenant.objects.create(name="Konveksi B", slug="konveksib")

        self.pm1 = ProductModel.objects.create(
            tenant=self.tenant1, code="PM_1", name="Model 1"
        )
        self.pv1 = ProductVariant.objects.create(
            tenant=self.tenant1, product_model=self.pm1, size="1"
        )
        self.usage_uom1 = UOM.objects.create(
            tenant=self.tenant1,
            code="CM",
            name="Centimeter",
            dimension=UOM.Dimension.LENGTH,
        )
        self.purchase_uom1 = UOM.objects.create(
            tenant=self.tenant1,
            code="ROLL",
            name="Roll",
            dimension=UOM.Dimension.LENGTH,
        )
        self.material1 = Material.objects.create(
            tenant=self.tenant1,
            code="MAT-1",
            name="Material 1",
            purchase_uom=self.purchase_uom1,
            usage_uom=self.usage_uom1,
            conversion_ratio=100,
        )
        self.bom1 = BOM.objects.create(
            tenant=self.tenant1,
            product_variant=self.pv1,
            version=1,
            effective_date=date(2026, 1, 1),
        )
        self.bom_item1 = BOMItem.objects.create(
            tenant=self.tenant1,
            bom=self.bom1,
            material=self.material1,
            quantity=3,
        )

        self.pm2 = ProductModel.objects.create(
            tenant=self.tenant2, code="PM_2", name="Model 2"
        )
        self.pv2 = ProductVariant.objects.create(
            tenant=self.tenant2, product_model=self.pm2, size="2"
        )

        self.po1 = ProductionOrder.objects.create(
            tenant=self.tenant1,
            order_number="SPK-1",
            order_type="for_stock",
            product_variant=self.pv1,
            target_quantity=100,
        )
        self.po2 = ProductionOrder.objects.create(
            tenant=self.tenant2,
            order_number="SPK-2",
            order_type="for_stock",
            product_variant=self.pv2,
            target_quantity=200,
        )

        self.user = User.objects.create_user(
            username="testuser", password="testpassword"
        )
        Membership.objects.create(
            user=self.user,
            tenant=self.tenant1,
            role=Membership.Role.KEPALA_KONVEKSI,
        )

        self.client1 = Client()
        login_resp = self.client1.post(
            "/api/auth/login",
            {
                "username": "testuser",
                "password": "testpassword",
                "tenant_slug": "konveksia",
            },
            content_type="application/json",
        )
        assert login_resp.status_code == 200

    def test_list_spks_isolated(self):
        response = self.client1.get("/api/production/orders")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["order_number"] == "SPK-1"

    def test_create_spk_tenant_assigned(self):
        payload = {
            "order_number": "SPK-1-NEW",
            "order_type": "for_stock",
            "product_variant_id": str(self.pv1.id),
            "target_quantity": 50,
        }
        response = self.client1.post(
            "/api/production/orders", data=payload, content_type="application/json"
        )
        assert response.status_code == 200
        data = response.json()

        # Verify in DB
        spk = ProductionOrder.objects.get(id=data["id"])
        assert spk.tenant_id == self.tenant1.id
        assert spk.bom_snapshot["id"] == str(self.bom1.id)
        requirement = MaterialRequirement.objects.get(
            tenant=self.tenant1, production_order=spk, material=self.material1
        )
        assert requirement.quantity_per_unit == 3
        assert requirement.required_usage_qty == 150

    def test_created_spk_keeps_material_snapshot_when_bom_changes(self):
        payload = {
            "order_number": "SPK-SNAPSHOT",
            "order_type": "for_stock",
            "product_variant_id": str(self.pv1.id),
            "target_quantity": 50,
        }
        response = self.client1.post(
            "/api/production/orders", data=payload, content_type="application/json"
        )
        assert response.status_code == 200
        spk = ProductionOrder.objects.get(id=response.json()["id"])
        self.bom_item1.quantity = 9
        self.bom_item1.save()

        recalc_response = self.client1.post(
            f"/api/production/orders/{spk.id}/mrp/recalculate"
        )

        assert recalc_response.status_code == 200
        requirement = MaterialRequirement.objects.get(
            tenant=self.tenant1, production_order=spk, material=self.material1
        )
        assert requirement.quantity_per_unit == 3
        assert requirement.required_usage_qty == 150
