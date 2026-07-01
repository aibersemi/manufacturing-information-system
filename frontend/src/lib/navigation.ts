import { type Capability, canAny } from "@/lib/capabilities";

export type NavGroupKey =
	| "main"
	| "masterdata"
	| "sales"
	| "production"
	| "inventory"
	| "labor"
	| "finance"
	| "accounting"
	| "reports"
	| "control"
	| "settings";

export type NavItemKey =
	| "home"
	| "customers"
	| "suppliers"
	| "materials"
	| "uoms"
	| "products"
	| "boms"
	| "routings"
	| "piece_rates"
	| "chart_of_accounts"
	| "bank_accounts"
	| "cost_categories"
	| "sales_orders"
	| "production_orders"
	| "job_packets"
	| "production_progress"
	| "progress_verification"
	| "qc"
	| "rework"
	| "scrap"
	| "production_costs"
	| "stock"
	| "purchase_requests"
	| "purchases"
	| "material_receipts"
	| "material_issues"
	| "stock_opnames"
	| "stock_adjustments"
	| "product_batches"
	| "attendance"
	| "operator_work_logs"
	| "cash_advances"
	| "piece_rate_payments"
	| "petty_cash"
	| "payment_requests"
	| "sales_invoices"
	| "sales_payments"
	| "purchase_invoices"
	| "purchase_payments"
	| "operational_expenses"
	| "assets_list"
	| "asset_depreciation"
	| "cost_allocations"
	| "journals"
	| "general_ledger"
	| "trial_balance"
	| "income_statement"
	| "balance_sheet"
	| "cash_flows"
	| "reports"
	| "control"
	| "tenants"
	| "users"
	| "operators";

export type NavItemDefinition = {
	key: NavItemKey;
	to: string;
	exact?: boolean;
	anyOf: readonly Capability[];
};

export type NavGroupDefinition = {
	key: NavGroupKey;
	items: readonly NavItemDefinition[];
};

export const NAV_GROUP_DEFINITIONS: readonly NavGroupDefinition[] = [
	{
		key: "main",
		items: [
			{
				key: "home",
				to: "/dashboard",
				exact: true,
				anyOf: [
					"dashboard.system",
					"dashboard.operational",
					"dashboard.finance",
					"dashboard.operator",
				],
			},
		],
	},
	{
		key: "masterdata",
		items: [
			{
				key: "customers",
				to: "/dashboard/masterdata/customers",
				anyOf: ["masterdata.customers.read"],
			},
			{
				key: "suppliers",
				to: "/dashboard/masterdata/suppliers",
				anyOf: ["masterdata.suppliers.read"],
			},
			{
				key: "materials",
				to: "/dashboard/masterdata/materials",
				anyOf: ["masterdata.materials.read"],
			},
			{
				key: "products",
				to: "/dashboard/masterdata/products",
				anyOf: ["masterdata.products.read", "masterdata.product_variants.read"],
			},
			{
				key: "boms",
				to: "/dashboard/masterdata/boms",
				anyOf: ["masterdata.boms.read"],
			},
			{
				key: "piece_rates",
				to: "/dashboard/masterdata/piece-rates",
				anyOf: ["masterdata.piece_rates.read"],
			},
			{
				key: "routings",
				to: "/dashboard/masterdata/routings",
				anyOf: ["masterdata.routings.read"],
			},
			{
				key: "chart_of_accounts",
				to: "/dashboard/masterdata/chart-of-accounts",
				anyOf: ["masterdata.chart_of_accounts.read"],
			},
			{
				key: "bank_accounts",
				to: "/dashboard/masterdata/bank-accounts",
				anyOf: ["masterdata.bank_accounts.read"],
			},
			{
				key: "cost_categories",
				to: "/dashboard/masterdata/cost-categories",
				anyOf: ["masterdata.cost_categories.read"],
			},
		],
	},
	{
		key: "sales",
		items: [
			{
				key: "sales_orders",
				to: "/dashboard/sales/orders",
				anyOf: ["sales.orders.read"],
			},
		],
	},
	{
		key: "production",
		items: [
			{
				key: "production_orders",
				to: "/dashboard/production/orders",
				anyOf: ["production.orders.read"],
			},
			{
				key: "job_packets",
				to: "/dashboard/production/job-packets",
				anyOf: ["production.job_packets.read", "production.job_packets.assigned.read"],
			},
			{
				key: "production_progress",
				to: "/dashboard/production/progress",
				anyOf: ["production.progress.create", "production.progress.submit.assigned"],
			},
			{
				key: "progress_verification",
				to: "/dashboard/production/verify",
				anyOf: ["production.progress.verify"],
			},
			{
				key: "qc",
				to: "/dashboard/production/qc",
				anyOf: ["production.progress.verify"],
			},
			{
				key: "rework",
				to: "/dashboard/production/rework",
				anyOf: ["production.progress.verify", "production.progress.submit.assigned"],
			},
			{
				key: "scrap",
				to: "/dashboard/production/scrap",
				anyOf: ["production.progress.verify"],
			},
			{
				key: "production_costs",
				to: "/dashboard/production/costs",
				anyOf: ["production.costs.read", "production.hpp.estimate", "reports.finance.read"],
			},
		],
	},
	{
		key: "inventory",
		items: [
			{
				key: "stock",
				to: "/dashboard/inventory/stock",
				anyOf: ["inventory.stock.read"],
			},
			{
				key: "purchase_requests",
				to: "/dashboard/inventory/purchase-requests",
				anyOf: ["inventory.purchase_requests.read"],
			},
			{
				key: "purchases",
				to: "/dashboard/inventory/purchases",
				anyOf: ["inventory.purchases.read"],
			},
			{
				key: "material_receipts",
				to: "/dashboard/inventory/receipts",
				anyOf: ["inventory.receipts.create"],
			},
			{
				key: "material_issues",
				to: "/dashboard/inventory/issues",
				anyOf: ["inventory.stock.read", "inventory.material_ledger.create"],
			},
			{
				key: "stock_opnames",
				to: "/dashboard/inventory/stock-opnames",
				anyOf: ["inventory.stock_opnames.read"],
			},
			{
				key: "stock_adjustments",
				to: "/dashboard/inventory/stock-adjustments",
				anyOf: ["inventory.stock_adjustments.create"],
			},
			{
				key: "product_batches",
				to: "/dashboard/inventory/product-batches",
				anyOf: ["inventory.product_batches.read"],
			},
		],
	},
	{
		key: "labor",
		items: [
			{
				key: "attendance",
				to: "/dashboard/labor/attendance",
				anyOf: ["labor.attendance.self", "labor.attendance.read"],
			},
			{
				key: "operator_work_logs",
				to: "/dashboard/labor/work-logs",
				anyOf: [
					"labor.work_log.self",
					"production.progress.verify",
					"labor.piece_rate.pay",
					"reports.operational.read",
				],
			},
			{
				key: "cash_advances",
				to: "/dashboard/labor/cash-advances",
				anyOf: ["labor.cash_advance.self", "labor.cash_advances.read"],
			},
			{
				key: "piece_rate_payments",
				to: "/dashboard/labor/payments",
				anyOf: ["labor.piece_rate.pay"],
			},
		],
	},
	{
		key: "finance",
		items: [
			{
				key: "petty_cash",
				to: "/dashboard/finance/petty-cash",
				anyOf: [
					"finance.petty_cash.read",
					"finance.petty_cash.create",
					"finance.petty_cash.dapur_draft",
				],
			},
			{
				key: "payment_requests",
				to: "/dashboard/finance/payment-requests",
				anyOf: [
					"finance.payment_requests.read",
					"finance.payment_requests.create",
					"finance.payment_requests.pay",
				],
			},
			{
				key: "sales_invoices",
				to: "/dashboard/finance/sales-invoices",
				anyOf: ["finance.customer_invoices.read"],
			},
			{
				key: "sales_payments",
				to: "/dashboard/finance/sales-payments",
				anyOf: ["finance.customer_payments.create", "finance.customer_invoices.read"],
			},
			{
				key: "purchase_invoices",
				to: "/dashboard/finance/purchase-invoices",
				anyOf: ["finance.supplier_invoices.read"],
			},
			{
				key: "purchase_payments",
				to: "/dashboard/finance/purchase-payments",
				anyOf: ["finance.supplier_invoices.pay", "finance.supplier_invoices.read"],
			},
			{
				key: "operational_expenses",
				to: "/dashboard/finance/expenses",
				anyOf: ["reports.finance.read", "finance.payment_requests.read"],
			},
			{
				key: "assets_list",
				to: "/dashboard/finance/assets",
				anyOf: ["finance.assets.read"],
			},
			{
				key: "asset_depreciation",
				to: "/dashboard/finance/depreciation",
				anyOf: ["finance.assets.read", "finance.assets.depreciation.post"],
			},
			{
				key: "cost_allocations",
				to: "/dashboard/finance/cost-allocations",
				anyOf: [
					"finance.cost_allocations.read",
					"reports.finance.read",
					"accounting.journals.read",
				],
			},
		],
	},
	{
		key: "accounting",
		items: [
			{
				key: "journals",
				to: "/dashboard/accounting/journals",
				anyOf: ["accounting.journals.read"],
			},
			{
				key: "general_ledger",
				to: "/dashboard/accounting/general-ledger",
				anyOf: ["accounting.reports.read", "reports.finance.read"],
			},
			{
				key: "trial_balance",
				to: "/dashboard/accounting/trial-balance",
				anyOf: ["accounting.reports.read", "reports.finance.read"],
			},
			{
				key: "income_statement",
				to: "/dashboard/accounting/income-statement",
				anyOf: ["reports.finance.read"],
			},
			{
				key: "balance_sheet",
				to: "/dashboard/accounting/balance-sheet",
				anyOf: ["reports.finance.read"],
			},
			{
				key: "cash_flows",
				to: "/dashboard/accounting/cash-flows",
				anyOf: ["reports.finance.read"],
			},
		],
	},
	{
		key: "reports",
		items: [
			{
				key: "reports",
				to: "/dashboard/reports",
				anyOf: ["reports.operational.read", "reports.finance.read"],
			},
		],
	},
	{
		key: "control",
		items: [
			{
				key: "control",
				to: "/dashboard/control",
				anyOf: [
					"core.notifications.read",
					"core.audit.read",
					"core.audit.self",
					"core.approvals.read",
				],
			},
		],
	},
	{
		key: "settings",
		items: [
			{
				key: "tenants",
				to: "/dashboard/settings/tenants",
				anyOf: ["settings.tenants.read"],
			},
			{
				key: "users",
				to: "/dashboard/settings/users",
				anyOf: ["settings.users.read"],
			},
			{
				key: "operators",
				to: "/dashboard/settings/operators",
				anyOf: ["settings.operators.read"],
			},
		],
	},
];

export function buildNavigation(capabilities: readonly Capability[] | undefined) {
	return NAV_GROUP_DEFINITIONS.map((group) => ({
		...group,
		items: group.items.filter((item) => canAny(capabilities, item.anyOf)),
	})).filter((group) => group.items.length > 0);
}
