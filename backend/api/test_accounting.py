import pytest
from django.test import Client

from backend.accounting.models import AccountingPeriod, JournalEntry
from backend.core.models import Membership, Tenant, User
from backend.masterdata.models import ChartOfAccount


@pytest.mark.django_db
def test_accounting_journal():
    client = Client()
    tenant = Tenant.objects.create(name="Konveksi A", slug="konveksi-a")
    user = User.objects.create_user(username="accuser", password="testpassword")
    Membership.objects.create(user=user, tenant=tenant, role=Membership.Role.FINANCE)
    client.post(
        "/api/auth/login",
        {
            "username": "accuser",
            "password": "testpassword",
            "tenant_slug": "konveksi-a",
        },
        content_type="application/json",
    )

    period = AccountingPeriod.objects.create(
        tenant_id=tenant.id,
        name="Juni 2026",
        start_date="2026-06-01",
        end_date="2026-06-30",
        status="open",
    )
    acc1 = ChartOfAccount.objects.create(
        tenant_id=tenant.id, code="1-1000", name="Kas", account_type="asset"
    )
    acc2 = ChartOfAccount.objects.create(
        tenant_id=tenant.id,
        code="4-1000",
        name="Pendapatan Jasa",
        account_type="revenue",
    )

    resp = client.post(
        "/api/accounting/journals",
        data={
            "period_id": str(period.id),
            "date": "2026-06-21",
            "description": "Pendapatan",
            "lines": [
                {"account_id": str(acc1.id), "debit": "1000000.00", "credit": "0.00"},
                {"account_id": str(acc2.id), "debit": "0.00", "credit": "1000000.00"},
            ],
        },
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert JournalEntry.objects.filter(tenant_id=tenant.id).count() == 1

    resp_fail = client.post(
        "/api/accounting/journals",
        data={
            "period_id": str(period.id),
            "date": "2026-06-21",
            "description": "Unbalanced",
            "lines": [
                {"account_id": str(acc1.id), "debit": "500000.00", "credit": "0.00"},
                {"account_id": str(acc2.id), "debit": "0.00", "credit": "400000.00"},
            ],
        },
        content_type="application/json",
    )
    assert resp_fail.status_code == 422
