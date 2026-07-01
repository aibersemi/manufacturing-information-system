# Django TestCase menginisialisasi data test melalui setUp.
# pylint: disable=attribute-defined-outside-init

import pytest
from django.test import Client

from backend.core.models import Membership, Tenant, User
from backend.masterdata.models import Customer
from backend.sales.models import SalesPO


@pytest.mark.django_db
class TestSalesPOIsolation:
    def setup_method(self):
        self.tenant1 = Tenant.objects.create(name="Konveksi A", slug="konveksia")
        self.tenant2 = Tenant.objects.create(name="Konveksi B", slug="konveksib")

        self.customer1 = Customer.objects.create(tenant=self.tenant1, name="Cust 1")
        self.customer2 = Customer.objects.create(tenant=self.tenant2, name="Cust 2")

        self.po1 = SalesPO.objects.create(
            tenant=self.tenant1,
            customer=self.customer1,
            po_number="PO-1",
            order_date="2026-06-21",
        )
        self.po2 = SalesPO.objects.create(
            tenant=self.tenant2,
            customer=self.customer2,
            po_number="PO-2",
            order_date="2026-06-21",
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

        self.super_user = User.objects.create_superuser(
            username="sales-super", password="testpassword"
        )
        self.super_client = Client()
        super_login_resp = self.super_client.post(
            "/api/auth/login",
            {
                "username": "sales-super",
                "password": "testpassword",
                "tenant_slug": "konveksia",
            },
            content_type="application/json",
        )
        assert super_login_resp.status_code == 200

    def test_list_pos_isolated(self):
        response = self.client1.get("/api/sales/orders")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["po_number"] == "PO-1"

    def test_create_po_tenant_assigned(self):
        payload = {
            "po_number": "PO-1-NEW",
            "customer_id": str(self.customer1.id),
            "order_date": "2026-06-22",
        }
        response = self.client1.post(
            "/api/sales/orders", data=payload, content_type="application/json"
        )
        assert response.status_code == 200
        data = response.json()

        # Verify in DB
        po = SalesPO.objects.get(id=data["id"])
        assert po.tenant_id == self.tenant1.id

    def test_update_po_tenant_assigned(self):
        payload = {
            "customer_id": str(self.customer1.id),
            "order_date": "2026-06-23",
            "due_date": "2026-06-30",
            "notes": "Revisi jadwal",
        }
        response = self.client1.put(
            f"/api/sales/orders/{self.po1.id}",
            data=payload,
            content_type="application/json",
        )

        assert response.status_code == 200
        self.po1.refresh_from_db()
        assert str(self.po1.customer_id) == str(self.customer1.id)
        assert self.po1.order_date.isoformat() == "2026-06-23"
        assert self.po1.due_date.isoformat() == "2026-06-30"
        assert self.po1.notes == "Revisi jadwal"
        assert self.po1.version == 2

    def test_delete_po_tenant_assigned(self):
        response = self.super_client.delete(f"/api/sales/orders/{self.po1.id}")

        assert response.status_code == 200
        assert not SalesPO.objects.filter(id=self.po1.id).exists()

    def test_kepala_delete_po_rejected(self):
        response = self.client1.delete(f"/api/sales/orders/{self.po1.id}")

        assert response.status_code == 403
        assert SalesPO.objects.filter(id=self.po1.id).exists()

    def test_delete_locked_po_rejected(self):
        self.po1.is_locked = True
        self.po1.save(update_fields=["is_locked", "updated_at"])

        response = self.super_client.delete(f"/api/sales/orders/{self.po1.id}")

        assert response.status_code == 409
        assert SalesPO.objects.filter(id=self.po1.id).exists()
