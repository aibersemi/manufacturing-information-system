import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiReportsCreateExport,
	useBackendApiReportsGetReport,
} from "@/api/generated/reports/reports";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { can } from "@/lib/capabilities";
import * as m from "@/paraglide/messages";
import { reportsRoute } from "./reports";

const REPORTS = [
	{ value: "sales_orders", title: m.reports_sales_orders },
	{ value: "production_orders", title: m.reports_production_orders },
	{ value: "production_progress", title: m.reports_production_progress },
	{ value: "work_assignments", title: m.reports_work_assignments },
	{ value: "productivity", title: m.reports_productivity },
	{ value: "scrap", title: m.reports_scrap },
	{ value: "material_stock", title: m.reports_material_stock },
	{ value: "product_stock", title: m.reports_product_stock },
	{ value: "purchases", title: m.reports_purchases },
	{ value: "stock_opname", title: m.reports_stock_opname },
	{ value: "stock_adjustments", title: m.reports_stock_adjustments },
	{ value: "attendance", title: m.reports_attendance },
	{ value: "piece_rate_payments", title: m.reports_piece_rate_payments },
	{ value: "cash_advances", title: m.reports_cash_advances },
	{ value: "deliveries", title: m.reports_deliveries },
	{ value: "returns", title: m.reports_returns },
	{ value: "invoices", title: m.reports_invoices },
	{ value: "payment_requests", title: m.reports_payment_requests },
	{ value: "petty_cash", title: m.reports_petty_cash },
	{ value: "expenses", title: m.reports_expenses },
	{ value: "assets", title: m.reports_assets },
	{ value: "depreciation", title: m.reports_depreciation },
	{ value: "hpp", title: m.reports_hpp },
	{ value: "profit_loss", title: m.reports_profit_loss },
	{ value: "balance_sheet", title: m.reports_balance_sheet },
	{ value: "cash_flow", title: m.reports_cash_flow },
	{ value: "journals", title: m.reports_journals },
	{ value: "audit", title: m.reports_audit },
] as const;

const OPERATIONAL_REPORTS = new Set([
	"sales_orders",
	"production_orders",
	"production_progress",
	"work_assignments",
	"productivity",
	"scrap",
	"material_stock",
	"product_stock",
	"purchases",
	"stock_opname",
	"stock_adjustments",
	"attendance",
	"piece_rate_payments",
	"cash_advances",
	"deliveries",
	"returns",
	"hpp",
	"audit",
]);

const FINANCE_REPORTS = new Set([
	"invoices",
	"payment_requests",
	"petty_cash",
	"expenses",
	"assets",
	"depreciation",
	"hpp",
	"profit_loss",
	"balance_sheet",
	"cash_flow",
	"journals",
	"audit",
]);

function getReportCellValue(row: readonly unknown[], columnIndex: number) {
	return row.at(columnIndex);
}

export function ReportsRouteScreen() {
	return (
		<AccessGuard anyOf={["reports.operational.read", "reports.finance.read"]}>
			<ReportsScreen />
		</AccessGuard>
	);
}

function ReportsScreen() {
	const search = reportsRoute.useSearch();
	const navigate = reportsRoute.useNavigate();
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canOperational = can(capabilityList, "reports.operational.read");
	const canFinance = can(capabilityList, "reports.finance.read");
	const visibleReports = REPORTS.filter((reportOption) => {
		if (canOperational && canFinance) return true;
		if (canOperational) return OPERATIONAL_REPORTS.has(reportOption.value);
		if (canFinance) return FINANCE_REPORTS.has(reportOption.value);
		return false;
	});
	const activeReport = visibleReports.some((item) => item.value === search.report)
		? search.report
		: (visibleReports.at(0)?.value ?? search.report);
	const report = useBackendApiReportsGetReport(activeReport, {
		date_from: search.date_from || undefined,
		date_to: search.date_to || undefined,
	});
	const exportMutation = useBackendApiReportsCreateExport();
	const data = report.data?.data;
	const label =
		visibleReports.find((reportOption) => reportOption.value === activeReport)?.title() ??
		m.reports_fallback();
	const columns: ColumnDef<unknown[]>[] = (data?.headers ?? []).map((header, index) => ({
		id: `${header}-${index}`,
		header: header.replaceAll("__", " / ").replaceAll("_", " "),
		cell: ({ row }) => {
			const value = getReportCellValue(row.original, index);
			return value == null
				? "—"
				: typeof value === "object"
					? JSON.stringify(value)
					: String(value);
		},
	}));

	const updateSearch = (patch: Partial<typeof search>) => {
		void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true });
	};

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div>
				<h1 className="text-2xl font-bold">{m.reports_title()}</h1>
				<p className="text-sm text-muted-foreground">{m.reports_description()}</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>{m.reports_filter_title()}</CardTitle>
					<CardDescription>{m.reports_filter_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup className="grid gap-4 md:grid-cols-3">
						<Field>
							<FieldLabel htmlFor="report-type">{m.reports_type()}</FieldLabel>
							<NativeSelect
								id="report-type"
								className="w-full"
								value={activeReport}
								onChange={(event) => updateSearch({ report: event.target.value })}
							>
								{visibleReports.map((reportOption) => (
									<NativeSelectOption key={reportOption.value} value={reportOption.value}>
										{reportOption.title()}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</Field>
						<Field>
							<FieldLabel htmlFor="date-from">{m.reports_date_from()}</FieldLabel>
							<Input
								id="date-from"
								type="date"
								value={search.date_from ?? ""}
								onChange={(event) => updateSearch({ date_from: event.target.value || undefined })}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="date-to">{m.reports_date_to()}</FieldLabel>
							<Input
								id="date-to"
								type="date"
								value={search.date_to ?? ""}
								onChange={(event) => updateSearch({ date_to: event.target.value || undefined })}
							/>
						</Field>
					</FieldGroup>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex-row items-start justify-between gap-4">
					<div>
						<CardTitle>{label}</CardTitle>
						<CardDescription>
							{m.reports_rows_found({ count: data?.rows.length ?? 0 })}
						</CardDescription>
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="icon"
							aria-label={m.reports_refresh()}
							onClick={() => void report.refetch()}
						>
							<RefreshCw />
						</Button>
						<Button
							onClick={() =>
								exportMutation.mutate({
									data: {
										report_type: activeReport,
										date_from: search.date_from,
										date_to: search.date_to,
									},
								})
							}
							disabled={exportMutation.isPending}
						>
							<Download data-icon="inline-start" />
							{m.reports_export()}
						</Button>
					</div>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					{report.isLoading ? (
						<DataLoading />
					) : report.isError ? (
						<DataError onRetry={() => void report.refetch()} />
					) : !data?.rows.length ? (
						<DataEmpty
							title={m.reports_empty_title()}
							description={m.reports_empty_description()}
						/>
					) : (
						<div className="overflow-x-auto">
							<DataTable
								columns={columns}
								data={data.rows}
								getRowId={(_row, index) => `${search.report}-${index}`}
							/>
						</div>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
