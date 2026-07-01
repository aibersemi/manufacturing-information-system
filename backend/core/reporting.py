"""Dataset laporan yang selalu difilter tenant dan dapat diekspor ulang."""

from __future__ import annotations

from datetime import date

from backend.accounting.models import JournalLine
from backend.core.models import AuditEvent, Tenant
from backend.finance.models import (
    Asset,
    CustomerInvoice,
    DepreciationSchedule,
    Expense,
    PaymentRequest,
    PettyCashTransaction,
)
from backend.inventory.models import (
    MaterialLedger,
    ProductLedger,
    PurchaseOrder,
    StockAdjustment,
    StockOpnameLine,
)
from backend.labor.models import Attendance, CashAdvance, PieceRatePayment
from backend.production.models import (
    HPPSnapshot,
    JobPacket,
    ProductionOrder,
    ProductionStageProgress,
    ScrapRecord,
)
from backend.sales.models import Delivery, SalesPO, SalesReturn

REPORT_FIELDS = {
    "sales_orders": (
        SalesPO,
        ["po_number", "order_date", "due_date", "status", "customer__name"],
    ),
    "production_orders": (
        ProductionOrder,
        ["order_number", "order_type", "status", "target_quantity", "output_quantity"],
    ),
    "production_progress": (
        ProductionStageProgress,
        [
            "created_at",
            "job_packet__packet_number",
            "stage__stage_name",
            "operator__name",
            "qty_in",
            "qty_good",
            "qty_defect",
            "qty_rework",
            "qty_scrap",
        ],
    ),
    "work_assignments": (
        JobPacket,
        [
            "packet_number",
            "production_order__order_number",
            "current_stage__stage_name",
            "assigned_operator__name",
            "quantity",
            "status",
        ],
    ),
    "productivity": (
        ProductionStageProgress,
        [
            "created_at",
            "operator__name",
            "stage__stage_name",
            "qty_good",
            "qty_defect",
            "qty_rework",
            "duration_minutes",
        ],
    ),
    "scrap": (
        ScrapRecord,
        [
            "created_at",
            "production_order__order_number",
            "quantity",
            "value",
            "reason",
            "responsible_operator__name",
            "approved_by__username",
        ],
    ),
    "material_stock": (
        MaterialLedger,
        [
            "created_at",
            "material__code",
            "material__name",
            "transaction_type",
            "quantity",
            "unit_cost",
            "reference_document",
        ],
    ),
    "product_stock": (
        ProductLedger,
        [
            "created_at",
            "product_variant__sku",
            "batch_lot_number",
            "from_category",
            "to_category",
            "quantity",
            "unit_cost",
        ],
    ),
    "purchases": (
        PurchaseOrder,
        [
            "po_number",
            "status",
            "supplier__name",
            "total_amount",
            "due_date",
            "reconciliation_status",
        ],
    ),
    "stock_opname": (
        StockOpnameLine,
        [
            "stock_opname__opname_number",
            "stock_opname__counted_at",
            "material__code",
            "product_variant__sku",
            "system_quantity",
            "physical_quantity",
            "difference_quantity",
            "reason",
        ],
    ),
    "stock_adjustments": (
        StockAdjustment,
        [
            "adjustment_number",
            "created_at",
            "material__code",
            "product_variant__sku",
            "quantity",
            "unit_cost",
            "reason",
            "status",
        ],
    ),
    "attendance": (
        Attendance,
        ["date", "operator__name", "is_present", "meal_eligible"],
    ),
    "piece_rate_payments": (
        PieceRatePayment,
        [
            "date",
            "operator__name",
            "gross_amount",
            "cash_advance_deduction",
            "net_paid",
        ],
    ),
    "cash_advances": (
        CashAdvance,
        ["date", "operator__name", "amount", "remaining_amount", "is_paid"],
    ),
    "deliveries": (
        Delivery,
        ["delivery_number", "date", "status", "receiver_name", "received_time"],
    ),
    "returns": (
        SalesReturn,
        ["return_number", "date", "customer__name", "status", "reason"],
    ),
    "invoices": (
        CustomerInvoice,
        [
            "invoice_number",
            "date",
            "due_date",
            "customer__name",
            "total_amount",
            "amount_paid",
            "status",
        ],
    ),
    "payment_requests": (
        PaymentRequest,
        ["request_number", "request_type", "recipient", "amount", "due_date", "status"],
    ),
    "petty_cash": (
        PettyCashTransaction,
        ["date", "type", "amount", "category", "description", "funding_mode", "status"],
    ),
    "expenses": (
        Expense,
        [
            "date",
            "category__name",
            "amount",
            "account__name",
            "related_party",
            "description",
        ],
    ),
    "assets": (
        Asset,
        [
            "name",
            "category",
            "acquisition_value",
            "acquisition_date",
            "useful_life_months",
            "depreciation_start_date",
            "status",
            "location",
        ],
    ),
    "depreciation": (
        DepreciationSchedule,
        ["date", "asset__name", "amount", "is_posted"],
    ),
    "hpp": (
        HPPSnapshot,
        [
            "created_at",
            "product_variant__sku",
            "cost_type",
            "quantity",
            "total_cost",
            "unit_cost",
            "margin_percent",
            "recommended_price",
            "components",
        ],
    ),
    "journals": (
        JournalLine,
        [
            "journal__entry_number",
            "journal__date",
            "account__code",
            "account__name",
            "debit",
            "credit",
        ],
    ),
    "profit_loss": (
        JournalLine,
        [
            "journal__entry_number",
            "journal__date",
            "account__code",
            "account__name",
            "account__account_type",
            "debit",
            "credit",
        ],
    ),
    "balance_sheet": (
        JournalLine,
        [
            "journal__entry_number",
            "journal__date",
            "account__code",
            "account__name",
            "account__account_type",
            "debit",
            "credit",
        ],
    ),
    "cash_flow": (
        JournalLine,
        [
            "journal__entry_number",
            "journal__date",
            "account__code",
            "account__name",
            "debit",
            "credit",
        ],
    ),
    "audit": (
        AuditEvent,
        [
            "created_at",
            "user__username",
            "action",
            "resource_type",
            "resource_id",
            "request_id",
            "detail",
        ],
    ),
}

REPORT_FILTERS = {
    "profit_loss": {"account__account_type__in": {"revenue", "expense"}},
    "balance_sheet": {"account__account_type__in": {"asset", "liability", "equity"}},
    "cash_flow": {"account__name__icontains": "kas"},
}


def report_dataset(
    tenant: Tenant,
    report_type: str,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[list[str], list[list]]:
    if report_type not in REPORT_FIELDS:
        raise ValueError("Jenis laporan tidak dikenal.")
    model, fields = REPORT_FIELDS[report_type]
    queryset = model.objects.filter(
        tenant=tenant, **REPORT_FILTERS.get(report_type, {})
    )
    date_field = "created_at"
    if any(field.name == "date" for field in model._meta.fields):
        date_field = "date"
    elif model is SalesPO:
        date_field = "order_date"
    if date_from:
        queryset = queryset.filter(**{f"{date_field}__gte": date_from})
    if date_to:
        queryset = queryset.filter(**{f"{date_field}__lte": date_to})
    values = list(queryset.order_by(f"-{date_field}").values_list(*fields))
    return fields, [list(row) for row in values]
