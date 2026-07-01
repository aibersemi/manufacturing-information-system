from datetime import date
from typing import Any, Optional

from django.db.models import Count, Sum
from django.http import HttpRequest
from ninja import Router, Schema
from ninja.errors import HttpError

from backend.core.access import (
    require_any_capability,
    require_capability,
    tenant_session_auth,
)
from backend.core.models import ExportJob, Membership, Tenant
from backend.core.reporting import report_dataset
from backend.finance.models import CustomerInvoice, PaymentRequest
from backend.production.models import MaterialRequirement, ProductionOrder
from backend.sales.models import SalesPO

router = Router(tags=["Reports"], auth=tenant_session_auth)

FINANCE_REPORT_TYPES = {
    "invoices",
    "payment_requests",
    "petty_cash",
    "expenses",
    "assets",
    "depreciation",
    "journals",
    "profit_loss",
    "balance_sheet",
    "cash_flow",
}


def _required_report_capability(report_type: str, *, export: bool = False) -> str:
    area = "finance" if report_type in FINANCE_REPORT_TYPES else "operational"
    action = "export" if export else "read"
    return f"reports.{area}.{action}"


class TenantSummary(Schema):
    id: int
    name: str
    code: str


class TenantComparison(Schema):
    id: int
    name: str
    code: str
    open_orders: int


class DashboardResponse(Schema):
    tenant: TenantSummary
    sales_orders_open: int
    production_active: int
    material_shortages: int
    payment_requests_waiting: int
    receivables: str
    tenant_comparison: list[TenantComparison] = []


class ReportResponse(Schema):
    headers: list[str]
    rows: list[list[Any]]


class ExportResponse(Schema):
    id: str
    status: str


@router.get("/dashboard", response=DashboardResponse)
def dashboard(request: HttpRequest):
    context = require_any_capability(
        request, {"reports.operational.read", "reports.finance.read"}
    )
    tenant = context.tenant
    payload = {
        "tenant": {"id": tenant.id, "name": tenant.name, "code": tenant.code},
        "sales_orders_open": SalesPO.objects.filter(tenant=tenant)
        .exclude(status__in={SalesPO.Status.COMPLETED, SalesPO.Status.CANCELLED})
        .count(),
        "production_active": ProductionOrder.objects.filter(
            tenant=tenant,
            status__in={
                ProductionOrder.Status.RELEASED,
                ProductionOrder.Status.IN_PROGRESS,
                ProductionOrder.Status.QC_PACKING,
            },
        ).count(),
        "material_shortages": MaterialRequirement.objects.filter(
            tenant=tenant, shortage_usage_qty__gt=0
        ).count(),
        "payment_requests_waiting": PaymentRequest.objects.filter(
            tenant=tenant, status=PaymentRequest.Status.WAITING
        ).count(),
        "receivables": str(
            CustomerInvoice.objects.filter(tenant=tenant)
            .exclude(status=CustomerInvoice.Status.PAID)
            .aggregate(total=Sum("total_amount") - Sum("amount_paid"))["total"]
            or 0
        ),
    }
    if context.role == Membership.Role.SUPER_ADMIN:
        payload["tenant_comparison"] = list(
            Tenant.objects.filter(is_active=True)
            .annotate(open_orders=Count("salespo"))
            .values("id", "name", "code", "open_orders")
        )
    return payload


@router.get("/{report_type}", response=ReportResponse)
def get_report(
    request: HttpRequest,
    report_type: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
):
    context = require_capability(
        request, _required_report_capability(report_type, export=False)
    )
    try:
        headers, rows = report_dataset(
            context.tenant,
            report_type,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as exc:
        raise HttpError(404, str(exc)) from exc
    return {"headers": headers, "rows": rows}


class ExportPayload(Schema):
    report_type: str
    date_from: Optional[date] = None
    date_to: Optional[date] = None


@router.post("/exports", response=ExportResponse)
def create_export(request: HttpRequest, payload: ExportPayload):
    context = require_capability(
        request, _required_report_capability(payload.report_type, export=True)
    )
    if (
        payload.report_type
        not in __import__(
            "backend.core.reporting", fromlist=["REPORT_FIELDS"]
        ).REPORT_FIELDS
    ):
        raise HttpError(422, "Jenis laporan tidak dikenal")
    job = ExportJob.objects.create(
        tenant=context.tenant,
        requested_by=request.user,
        report_type=payload.report_type,
        filters={
            "date_from": payload.date_from.isoformat() if payload.date_from else None,
            "date_to": payload.date_to.isoformat() if payload.date_to else None,
        },
    )
    from backend.core.tasks import (  # pylint: disable=import-outside-toplevel
        generate_report_export,
    )

    generate_report_export.send(str(job.id))
    return {"id": str(job.id), "status": job.status}
