from datetime import timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.utils import timezone

from backend.core.models import Membership, Tenant
from backend.core.notifications import create_role_notifications
from backend.finance.models import PaymentRequest
from backend.production.models import MaterialRequirement, ProductionOrder


class Command(BaseCommand):
    help = "Rekonsiliasi search dan eskalasi notifikasi operasional berkala."

    def handle(self, *args, **options):
        call_command("reindex_search", check_only=True, skip_if_permission_denied=True)
        now = timezone.now()
        for tenant in Tenant.objects.filter(is_active=True).select_related(
            "business_policy"
        ):
            policy = tenant.business_policy
            material_deadline = now - timedelta(
                hours=policy.material_alert_escalation_hours
            )
            shortages = MaterialRequirement.objects.filter(
                tenant=tenant,
                shortage_usage_qty__gt=0,
                updated_at__lte=material_deadline,
                production_order__status__in={
                    ProductionOrder.Status.PLANNED,
                    ProductionOrder.Status.RELEASED,
                    ProductionOrder.Status.IN_PROGRESS,
                },
            )
            for shortage in shortages:
                create_role_notifications(
                    tenant=tenant,
                    event_type="material_shortage_escalation",
                    title="Eskalasi kekurangan material",
                    message=f"{shortage.production_order.order_number}: {shortage.material.code}",
                    safe_path=f"/production/orders/{shortage.production_order_id}",
                    deduplication_key=f"mrp-escalation:{shortage.id}:{now.date()}",
                    roles={Membership.Role.SUPER_ADMIN},
                    telegram=True,
                )
            payment_deadline = now - timedelta(
                hours=policy.payment_alert_escalation_hours
            )
            requests = PaymentRequest.objects.filter(
                tenant=tenant,
                status=PaymentRequest.Status.WAITING,
                updated_at__lte=payment_deadline,
            )
            for payment_request in requests:
                create_role_notifications(
                    tenant=tenant,
                    event_type="payment_request_escalation",
                    title="Eskalasi permintaan pembayaran",
                    message=f"{payment_request.request_number}: Rp {payment_request.amount}",
                    safe_path=f"/finance/payment-requests/{payment_request.id}",
                    deduplication_key=f"payment-escalation:{payment_request.id}:{now.date()}",
                    roles={Membership.Role.SUPER_ADMIN},
                    telegram=True,
                )
        self.stdout.write(self.style.SUCCESS("Scheduled maintenance selesai."))
