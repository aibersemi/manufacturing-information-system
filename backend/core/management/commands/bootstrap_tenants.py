from django.core.management.base import BaseCommand

from backend.core.models import Tenant
from backend.masterdata.services import bootstrap_tenant


class Command(BaseCommand):
    help = "Buat gudang, kebijakan, UOM, dan Chart of Accounts default per tenant."

    def handle(self, *args, **options):
        for tenant in Tenant.objects.all():
            bootstrap_tenant(tenant)
            self.stdout.write(self.style.SUCCESS(f"Bootstrap selesai: {tenant.slug}"))
