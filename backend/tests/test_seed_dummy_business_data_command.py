import os
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from backend.accounting.models import JournalEntry
from backend.core.models import Tenant
from backend.inventory.models import ProductBatch, PurchaseOrder
from backend.production.models import ProductionOrder
from backend.sales.models import SalesPO


class SeedDummyBusinessDataCommandTests(TestCase):
    def setUp(self):
        # We need a tenant with basic roles and standard setup.
        # Running the seed_dummy_konveksi command first to prepare the environment.
        os.environ["DUMMY_TENANT_SLUG"] = "dummy-konveksi-test"

        # Patch stdout to avoid clutter
        with patch("sys.stdout.write"):
            call_command("seed_dummy_konveksi")

        self.tenant = Tenant.objects.get(slug="dummy-konveksi-test")

    def test_seed_command_idempotency(self):
        # First run
        with patch("sys.stdout.write"):
            call_command("seed_dummy_business_data", tenant_slug=self.tenant.slug)

        # Assert data exists
        po_count = PurchaseOrder.objects.filter(tenant=self.tenant).count()
        self.assertGreater(po_count, 0)

        spo_count = SalesPO.objects.filter(tenant=self.tenant).count()
        self.assertGreater(spo_count, 0)

        prod_count = ProductionOrder.objects.filter(tenant=self.tenant).count()
        self.assertGreater(prod_count, 0)

        journal_count = JournalEntry.objects.filter(tenant=self.tenant).count()
        self.assertGreater(journal_count, 0)

        batch_count = ProductBatch.objects.filter(tenant=self.tenant).count()
        self.assertGreater(batch_count, 0)

        # Check journal lines balance
        for je in JournalEntry.objects.filter(tenant=self.tenant):
            debits = sum(line.debit for line in je.lines.all())
            total_credits = sum(line.credit for line in je.lines.all())
            self.assertEqual(debits, total_credits)

        # Run command again to test idempotency
        with patch("sys.stdout.write"):
            call_command("seed_dummy_business_data", tenant_slug=self.tenant.slug)

        # Ensure no duplicates
        self.assertEqual(
            po_count, PurchaseOrder.objects.filter(tenant=self.tenant).count()
        )
        self.assertEqual(spo_count, SalesPO.objects.filter(tenant=self.tenant).count())
        self.assertEqual(
            prod_count, ProductionOrder.objects.filter(tenant=self.tenant).count()
        )
        self.assertEqual(
            journal_count, JournalEntry.objects.filter(tenant=self.tenant).count()
        )
        self.assertEqual(
            batch_count, ProductBatch.objects.filter(tenant=self.tenant).count()
        )

    def test_seed_command_fails_without_base_tenant(self):
        with self.assertRaises(Exception):
            call_command("seed_dummy_business_data", tenant_slug="non-existent-tenant")
