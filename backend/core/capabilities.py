"""Capability matrix dan helper otorisasi operator MIS."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from django.http import HttpRequest
from ninja.errors import HttpError

from backend.core.models import Membership, Tenant, User
from backend.masterdata.models import Operator

Capability = str

READ = ("read",)
CRU = ("read", "create", "update")
CRUD = ("read", "create", "update", "delete")
CRU_ACTIVE = ("read", "create", "update", "activate", "deactivate")
CRUD_ACTIVE = ("read", "create", "update", "delete", "activate", "deactivate")


def _caps(prefix: str, actions: Iterable[str]) -> set[Capability]:
    return {f"{prefix}.{action}" for action in actions}


BASE_CAPABILITIES = {
    "tenant.switch",
    "auth.change_password",
    "dashboard.system",
    "dashboard.operational",
    "dashboard.finance",
    "dashboard.operator",
    "core.notifications.read",
    "core.audit.read",
    "core.audit.self",
    "core.approvals.read",
    "core.approvals.review",
}

SETTINGS_CAPABILITIES = (
    _caps("settings.tenants", CRUD_ACTIVE)
    | _caps("settings.users", CRUD_ACTIVE)
    | {"settings.users.reset_password"}
    | _caps("settings.operators", CRUD_ACTIVE)
    | {"settings.operators.reset_password"}
)

OPERATIONAL_MASTERDATA_RESOURCES = (
    "masterdata.customers",
    "masterdata.suppliers",
    "masterdata.uoms",
    "masterdata.materials",
    "masterdata.products",
    "masterdata.product_variants",
    "masterdata.boms",
    "masterdata.bom_items",
    "masterdata.routings",
    "masterdata.routing_stages",
    "masterdata.piece_rates",
)
FINANCE_MASTERDATA_RESOURCES = (
    "masterdata.chart_of_accounts",
    "masterdata.bank_accounts",
    "masterdata.cost_categories",
)

MASTERDATA_CAPABILITIES = set().union(
    *(
        _caps(resource, CRUD_ACTIVE)
        for resource in (
            *OPERATIONAL_MASTERDATA_RESOURCES,
            *FINANCE_MASTERDATA_RESOURCES,
        )
    )
) | {"masterdata.operators.read"}

SALES_CAPABILITIES = (
    _caps("sales.orders", CRUD)
    | {"sales.orders.fulfillment", "sales.orders.short_close"}
    | {"sales.deliveries.create", "sales.deliveries.close", "sales.returns.create"}
)

PRODUCTION_CAPABILITIES = (
    {"production.hpp.estimate"}
    | _caps("production.orders", CRU)
    | {
        "production.orders.release",
        "production.orders.complete",
        "production.orders.recalculate_mrp",
        "production.orders.reserve_materials",
        "production.orders.generate_purchase_requests",
        "production.orders.issue_materials",
    }
    | {"production.job_packets.read", "production.job_packets.create"}
    | {"production.job_packets.accept", "production.job_packets.assigned.read"}
    | {"production.progress.create", "production.progress.submit.assigned"}
    | {"production.progress.verify"}
    | {"production.rework.read", "production.rework.complete"}
    | {"production.rework.assigned.complete"}
    | {"production.scrap.read", "production.scrap.approve"}
    | {"production.work_logs.read", "production.work_logs.adjust_rate"}
    | {"production.work_logs.payment_request"}
    | _caps("production.costs", ("read", "create"))
)

INVENTORY_CAPABILITIES = (
    {"inventory.stock.read"}
    | {"inventory.material_ledger.read", "inventory.material_ledger.create"}
    | {"inventory.product_ledger.read"}
    | {"inventory.purchase_requests.read", "inventory.purchase_requests.create"}
    | {"inventory.purchase_requests.submit"}
    | {"inventory.purchases.read", "inventory.purchases.create"}
    | {"inventory.purchases.confirm", "inventory.purchases.cancel"}
    | {"inventory.material_balance.read", "inventory.product_batches.read"}
    | {"inventory.receipts.create"}
    | {"inventory.stock_adjustments.create", "inventory.stock_adjustments.approve"}
    | _caps("inventory.stock_opnames", ("read", "create", "update", "approve"))
)

LABOR_CAPABILITIES = (
    {"labor.attendance.read", "labor.attendance.create"}
    | {"labor.attendance.self"}
    | {"labor.cash_advances.read", "labor.cash_advances.create"}
    | {"labor.cash_advance.self"}
    | {"labor.work_logs.self"}
    | {"labor.piece_rate.pay"}
)

FINANCE_CAPABILITIES = (
    {"finance.petty_cash.read", "finance.petty_cash.create"}
    | {"finance.petty_cash.dapur_draft", "finance.petty_cash.verify"}
    | {"finance.petty_cash.balance"}
    | {"finance.payment_requests.read", "finance.payment_requests.create"}
    | {"finance.payment_requests.defer", "finance.payment_requests.pay"}
    | _caps("finance.assets", CRUD_ACTIVE)
    | {"finance.assets.dispose", "finance.assets.depreciation.post"}
    | {"finance.customer_invoices.read", "finance.customer_invoices.create"}
    | {"finance.customer_payments.create"}
    | {"finance.supplier_invoices.read", "finance.supplier_invoices.create"}
    | {"finance.supplier_invoices.pay"}
    | _caps("finance.cost_allocations", ("read", "create"))
)

ACCOUNTING_CAPABILITIES = (
    {"accounting.journals.read", "accounting.journals.create"}
    | {"accounting.journals.reverse"}
    | {"accounting.periods.read", "accounting.periods.close"}
    | {"accounting.periods.reopen"}
    | {"accounting.reports.read"}
)

REPORT_CAPABILITIES = {
    "reports.operational.read",
    "reports.finance.read",
    "reports.operational.export",
    "reports.finance.export",
}

LEGACY_CAPABILITIES = {
    "settings.tenants.manage",
    "settings.users.manage",
    "settings.operators.manage",
    "masterdata.read",
    "masterdata.manage",
    "sales.orders.manage",
    "production.orders.manage",
    "production.job_packets.manage",
    "inventory.purchase.read",
    "inventory.purchase.manage",
    "inventory.stock.manage",
    "labor.attendance.manage",
    "labor.cash_advance.manage",
    "finance.payment_requests.pay",
    "finance.assets.read",
    "finance.assets.manage",
    "accounting.journal.manage",
    "accounting.period.manage",
}

ALL_CAPABILITIES = frozenset(
    BASE_CAPABILITIES
    | SETTINGS_CAPABILITIES
    | MASTERDATA_CAPABILITIES
    | SALES_CAPABILITIES
    | PRODUCTION_CAPABILITIES
    | INVENTORY_CAPABILITIES
    | LABOR_CAPABILITIES
    | FINANCE_CAPABILITIES
    | ACCOUNTING_CAPABILITIES
    | REPORT_CAPABILITIES
    | LEGACY_CAPABILITIES
)

OPERATIONAL_MASTERDATA_READ = set().union(
    *(_caps(resource, READ) for resource in OPERATIONAL_MASTERDATA_RESOURCES)
) | {"masterdata.operators.read"}
OPERATIONAL_MASTERDATA_CRU_ACTIVE = set().union(
    *(_caps(resource, CRU_ACTIVE) for resource in OPERATIONAL_MASTERDATA_RESOURCES)
)
OPERATIONAL_MASTERDATA_FULL = set().union(
    *(_caps(resource, CRUD_ACTIVE) for resource in OPERATIONAL_MASTERDATA_RESOURCES)
)
FINANCE_MASTERDATA_READ = set().union(
    *(_caps(resource, READ) for resource in FINANCE_MASTERDATA_RESOURCES)
)
FINANCE_MASTERDATA_FULL = set().union(
    *(_caps(resource, CRUD_ACTIVE) for resource in FINANCE_MASTERDATA_RESOURCES)
)

FINANCE_AREA_FULL = (
    FINANCE_CAPABILITIES
    | ACCOUNTING_CAPABILITIES
    | FINANCE_MASTERDATA_FULL
    | {"reports.finance.read", "reports.finance.export"}
)

OPERATIONAL_READ_ONLY = (
    OPERATIONAL_MASTERDATA_READ
    | {"sales.orders.read"}
    | {"production.orders.read", "production.job_packets.read"}
    | {"production.rework.read", "production.scrap.read", "production.work_logs.read"}
    | {"production.costs.read"}
    | {"inventory.stock.read", "inventory.material_ledger.read"}
    | {"inventory.product_ledger.read", "inventory.purchase_requests.read"}
    | {"inventory.purchases.read", "inventory.material_balance.read"}
    | {"inventory.product_batches.read", "inventory.stock_opnames.read"}
    | {"labor.attendance.read", "labor.cash_advances.read"}
)

KEPALA_OPERATIONAL = OPERATIONAL_MASTERDATA_CRU_ACTIVE | {
    "auth.change_password",
    "dashboard.operational",
    "settings.operators.read",
    "masterdata.operators.read",
    "settings.operators.create",
    "settings.operators.update",
    "settings.operators.activate",
    "settings.operators.deactivate",
    "sales.orders.read",
    "sales.orders.create",
    "sales.orders.update",
    "sales.orders.fulfillment",
    "sales.orders.short_close",
    "sales.deliveries.create",
    "sales.deliveries.close",
    "sales.returns.create",
    "production.hpp.estimate",
    "production.orders.read",
    "production.orders.create",
    "production.orders.update",
    "production.orders.release",
    "production.orders.complete",
    "production.orders.recalculate_mrp",
    "production.orders.reserve_materials",
    "production.orders.generate_purchase_requests",
    "production.orders.issue_materials",
    "production.job_packets.read",
    "production.job_packets.create",
    "production.job_packets.accept",
    "production.progress.create",
    "production.progress.verify",
    "production.rework.read",
    "production.rework.complete",
    "production.scrap.read",
    "production.scrap.approve",
    "production.work_logs.read",
    "production.work_logs.adjust_rate",
    "production.work_logs.payment_request",
    "production.costs.read",
    "production.costs.create",
    "inventory.stock.read",
    "inventory.material_ledger.read",
    "inventory.material_ledger.create",
    "inventory.product_ledger.read",
    "inventory.purchase_requests.read",
    "inventory.purchase_requests.create",
    "inventory.purchase_requests.submit",
    "inventory.purchases.read",
    "inventory.purchases.create",
    "inventory.purchases.confirm",
    "inventory.purchases.cancel",
    "inventory.material_balance.read",
    "inventory.product_batches.read",
    "inventory.receipts.create",
    "inventory.stock_adjustments.create",
    "inventory.stock_adjustments.approve",
    "inventory.stock_opnames.read",
    "inventory.stock_opnames.create",
    "inventory.stock_opnames.update",
    "inventory.stock_opnames.approve",
    "labor.attendance.read",
    "labor.attendance.create",
    "labor.cash_advances.read",
    "labor.cash_advances.create",
    "finance.petty_cash.read",
    "finance.petty_cash.create",
    "finance.petty_cash.verify",
    "finance.payment_requests.read",
    "finance.payment_requests.create",
    "reports.operational.read",
    "reports.operational.export",
    "core.notifications.read",
    "core.audit.read",
    "core.approvals.read",
}

FINANCE_ROLE_CAPABILITIES = (
    {
        "tenant.switch",
        "auth.change_password",
        "dashboard.finance",
        "core.notifications.read",
        "core.audit.read",
        "labor.piece_rate.pay",
    }
    | OPERATIONAL_READ_ONLY
    | FINANCE_AREA_FULL
)

KEPALA_LEGACY_CAPABILITIES = {
    "settings.operators.manage",
    "masterdata.read",
    "masterdata.manage",
    "sales.orders.manage",
    "production.orders.manage",
    "production.job_packets.manage",
    "inventory.purchase.manage",
    "inventory.stock.manage",
    "labor.attendance.manage",
    "labor.cash_advance.manage",
}

FINANCE_LEGACY_CAPABILITIES = {
    "masterdata.read",
    "sales.orders.read",
    "production.orders.read",
    "production.job_packets.read",
    "inventory.stock.read",
    "inventory.purchase.read",
    "finance.payment_requests.pay",
    "finance.assets.read",
    "finance.assets.manage",
    "accounting.journal.manage",
    "accounting.period.manage",
}

ROLE_CAPABILITIES: dict[str, frozenset[Capability]] = {
    Membership.Role.SUPER_ADMIN: ALL_CAPABILITIES,
    Membership.Role.KEPALA_KONVEKSI: frozenset(
        KEPALA_OPERATIONAL | KEPALA_LEGACY_CAPABILITIES
    ),
    Membership.Role.FINANCE: frozenset(
        FINANCE_ROLE_CAPABILITIES | FINANCE_LEGACY_CAPABILITIES
    ),
    Membership.Role.OPERATOR: frozenset(
        {
            "auth.change_password",
            "dashboard.operator",
            "core.notifications.read",
            "core.audit.self",
        }
    ),
}

PROGRESS_OPERATOR_TYPES = frozenset(
    {
        Operator.OperatorType.PENJAHIT,
        Operator.OperatorType.MAKLON,
        Operator.OperatorType.POTONG,
        Operator.OperatorType.SABLON,
        Operator.OperatorType.GUDANG,
        Operator.OperatorType.PEMBELIAN,
        Operator.OperatorType.QC,
        Operator.OperatorType.PACKING,
        Operator.OperatorType.MANDOR,
    }
)

OPERATOR_TYPE_CAPABILITIES: dict[str, frozenset[Capability]] = {
    Operator.OperatorType.DAPUR: frozenset(
        {"finance.petty_cash.read", "finance.petty_cash.dapur_draft"}
    ),
}

STAGE_KEYWORDS_BY_OPERATOR_TYPE: dict[str, tuple[str, ...]] = {
    Operator.OperatorType.PENJAHIT: ("jahit", "sew"),
    Operator.OperatorType.MAKLON: ("maklon", "luar", "outsource"),
    Operator.OperatorType.POTONG: ("potong", "cut"),
    Operator.OperatorType.SABLON: ("sablon", "screen"),
    Operator.OperatorType.GUDANG: ("gudang", "warehouse", "serah", "material"),
    Operator.OperatorType.PEMBELIAN: ("beli", "purchase", "pembelian", "terima"),
    Operator.OperatorType.QC: ("qc", "quality", "kontrol"),
    Operator.OperatorType.PACKING: ("packing", "kemas", "pack"),
}


@dataclass(frozen=True)
class OperatorContext:
    """Profil operator aktif yang terikat pada user dan tenant request."""

    operator: Operator

    @property
    def id(self):
        return self.operator.id

    @property
    def operator_type(self) -> str:
        return self.operator.operator_type

    @property
    def status(self) -> str:
        return self.operator.status

    @property
    def is_active(self) -> bool:
        return self.operator.is_active


def resolve_operator_context(tenant: Tenant, user: User) -> OperatorContext | None:
    operator = (
        Operator.objects.select_related("supervisor")
        .filter(tenant=tenant, user=user, is_active=True)
        .first()
    )
    return OperatorContext(operator=operator) if operator is not None else None


def get_operator_context(request: HttpRequest) -> OperatorContext | None:
    context = getattr(request, "tenant_context", None)
    if context is None:
        return None
    return resolve_operator_context(context.tenant, request.user)


def require_operator_context(request: HttpRequest) -> OperatorContext:
    operator_context = get_operator_context(request)
    if operator_context is None:
        raise HttpError(403, "Akun belum terhubung dengan profil operator aktif")
    return operator_context


def require_operator_type(
    request: HttpRequest, allowed_types: Iterable[str]
) -> OperatorContext:
    operator_context = require_operator_context(request)
    if operator_context.operator_type not in set(allowed_types):
        raise HttpError(403, "Fungsi operator tidak memiliki akses untuk aksi ini")
    return operator_context


def require_assigned_operator(job_packet: Any, operator: Operator) -> None:
    if job_packet.assigned_operator_id is None:
        raise HttpError(403, "Paket belum ditugaskan kepada operator")
    if str(job_packet.assigned_operator_id) != str(operator.id):
        raise HttpError(403, "Paket tidak ditugaskan kepada operator ini")


def operator_can_submit_stage(operator: Operator, stage: Any) -> bool:
    if operator.operator_type == Operator.OperatorType.MANDOR:
        return True

    keywords = STAGE_KEYWORDS_BY_OPERATOR_TYPE.get(operator.operator_type, ())
    stage_name = (getattr(stage, "stage_name", "") or "").casefold()
    return any(keyword in stage_name for keyword in keywords)


def capabilities_for(role: str, operator_context: OperatorContext | None) -> list[str]:
    capabilities = set(ROLE_CAPABILITIES.get(role, frozenset()))
    if role != Membership.Role.OPERATOR:
        return sorted(capabilities)

    if operator_context is None:
        return sorted(capabilities)

    operator = operator_context.operator
    capabilities.add("production.job_packets.assigned.read")
    capabilities.add("production.job_packets.accept")
    capabilities.add("production.rework.assigned.complete")
    capabilities.add("labor.work_log.self")

    if operator.operator_type in PROGRESS_OPERATOR_TYPES:
        capabilities.add("production.progress.submit.assigned")

    if operator.status == Operator.OperatorStatus.INTERNAL:
        capabilities.add("labor.attendance.self")
        capabilities.add("labor.cash_advance.self")

    capabilities.update(OPERATOR_TYPE_CAPABILITIES.get(operator.operator_type, ()))
    return sorted(capabilities)
