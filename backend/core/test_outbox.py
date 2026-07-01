from datetime import date

import pytest

from backend.core.models import OutboxEvent, Tenant
from backend.masterdata.models import Customer
from backend.sales.models import SalesPO


@pytest.mark.django_db
def test_outbox_event_creation():
    # Setup Tenant
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")

    # Clear outbox
    OutboxEvent.objects.all().delete()

    # Create Customer
    cust = Customer.objects.create(tenant=tenant, name="Toko Abadi", phone="081111")

    # Check outbox
    events = OutboxEvent.objects.filter(event_type="customers_upsert")
    assert events.count() == 1
    event = events.first()
    assert event.payload["action"] == "upsert"
    assert event.payload["index"] == "customers"
    assert event.payload["data"]["id"] == str(cust.id)
    assert event.payload["data"]["name"] == "Toko Abadi"

    # Create SalesPO
    po = SalesPO.objects.create(
        tenant=tenant, customer=cust, po_number="PO-2023-001", order_date=date.today()
    )

    # Check outbox
    events_po = OutboxEvent.objects.filter(event_type="sales_po_upsert")
    assert events_po.count() == 1
    event_po = events_po.first()
    assert event_po.payload["index"] == "sales_po"
    assert event_po.payload["data"]["po_number"] == "PO-2023-001"

    # Test delete
    po_id_str = str(po.id)
    po.delete()
    events_del = OutboxEvent.objects.filter(event_type="sales_po_delete")
    assert events_del.count() == 1
    event_del = events_del.first()
    assert event_del.payload["action"] == "delete"
    assert event_del.payload["data"]["id"] == po_id_str
