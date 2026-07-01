"""Invariant tenant ownership pada seluruh model bisnis."""

import pytest
from django.core.exceptions import ValidationError

from backend.core.models import Tenant
from backend.masterdata.models import Customer
from backend.sales.models import SalesPO


@pytest.mark.django_db
def test_model_menolak_foreign_key_lintas_tenant():
    tenant_a = Tenant.objects.create(name="Tenant A", slug="tenant-a")
    tenant_b = Tenant.objects.create(name="Tenant B", slug="tenant-b")
    customer_b = Customer.objects.create(tenant=tenant_b, name="Pelanggan B")

    with pytest.raises(ValidationError, match="konveksi lain"):
        SalesPO.objects.create(
            tenant=tenant_a,
            customer=customer_b,
            po_number="A/PO/202606/0001",
            order_date="2026-06-21",
        )


@pytest.mark.django_db
def test_model_menolak_perpindahan_tenant():
    tenant_a = Tenant.objects.create(name="Tenant A", slug="tenant-a")
    tenant_b = Tenant.objects.create(name="Tenant B", slug="tenant-b")
    customer = Customer.objects.create(tenant=tenant_a, name="Pelanggan A")

    customer.tenant = tenant_b

    with pytest.raises(ValidationError, match="tidak dapat dipindahkan"):
        customer.save()
