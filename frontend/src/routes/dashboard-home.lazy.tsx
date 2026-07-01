import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowRight,
	Banknote,
	Factory,
	ListChecks,
	PackageSearch,
	ShoppingCart,
	UserCheck,
	WalletCards,
} from "lucide-react";

import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiLaborListAttendance,
	useBackendApiLaborListCashAdvances,
	useBackendApiLaborListOwnPieceRatePayments,
	useBackendApiLaborListOwnWorkLogs,
} from "@/api/generated/labor/labor";
import type { DashboardResponse } from "@/api/generated/models";
import { useBackendApiProductionListJobPackets } from "@/api/generated/production/production";
import { useBackendApiReportsDashboard } from "@/api/generated/reports/reports";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { can } from "@/lib/capabilities";
import { formatCurrency } from "@/lib/i18n";
import * as m from "@/paraglide/messages";

const METRICS = [
	{
		key: "sales_orders_open",
		label: m.dashboard_metric_open_sales,
		icon: ShoppingCart,
		to: "/dashboard/sales/orders",
		getValue: (data?: DashboardResponse) => data?.sales_orders_open ?? 0,
	},
	{
		key: "production_active",
		label: m.dashboard_metric_active_production,
		icon: Factory,
		to: "/dashboard/production/orders",
		getValue: (data?: DashboardResponse) => data?.production_active ?? 0,
	},
	{
		key: "material_shortages",
		label: m.dashboard_metric_material_shortages,
		icon: PackageSearch,
		to: "/dashboard/reports",
		getValue: (data?: DashboardResponse) => data?.material_shortages ?? 0,
	},
	{
		key: "payment_requests_waiting",
		label: m.dashboard_metric_waiting_payments,
		icon: Banknote,
		to: "/dashboard/finance/payment-requests",
		getValue: (data?: DashboardResponse) => data?.payment_requests_waiting ?? 0,
	},
] as const;

export function DashboardHome() {
	const capabilities = useBackendApiAuthGetCapabilities();
	const session = capabilities.data?.status === 200 ? capabilities.data.data : undefined;
	const capabilityList = session?.capabilities;
	const isOperatorDashboard = can(capabilityList, "dashboard.operator");
	const dashboard = useBackendApiReportsDashboard({
		query: { enabled: Boolean(session) && !isOperatorDashboard },
	});
	const assignedPackets = useBackendApiProductionListJobPackets(undefined, {
		query: {
			enabled: isOperatorDashboard && can(capabilityList, "production.job_packets.assigned.read"),
		},
	});
	const attendance = useBackendApiLaborListAttendance(undefined, {
		query: { enabled: isOperatorDashboard && can(capabilityList, "labor.attendance.self") },
	});
	const cashAdvances = useBackendApiLaborListCashAdvances({
		query: { enabled: isOperatorDashboard && can(capabilityList, "labor.cash_advance.self") },
	});
	const workLogs = useBackendApiLaborListOwnWorkLogs({
		query: { enabled: isOperatorDashboard && can(capabilityList, "labor.work_log.self") },
	});
	const payments = useBackendApiLaborListOwnPieceRatePayments({
		query: { enabled: isOperatorDashboard && can(capabilityList, "labor.work_log.self") },
	});
	const data = dashboard.data?.data;

	if (isOperatorDashboard) {
		const operator = session?.operator;
		const openAdvances = cashAdvances.data?.data.filter((advance) => !advance.is_paid).length ?? 0;
		const unpaidLogs = workLogs.data?.data.filter((log) => !log.is_paid).length ?? 0;

		return (
			<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
				<div className="flex flex-col gap-2">
					<Badge variant="outline" className="w-fit">
						{m.operator_dashboard_badge()}
					</Badge>
					<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
						{m.operator_dashboard_title({
							name: operator?.name ?? session?.user.full_name ?? m.common_user(),
						})}
					</h1>
					<p className="text-sm text-muted-foreground">
						{m.operator_dashboard_description({
							type: operator?.operator_type ?? "-",
							status: operator?.status ?? "-",
						})}
					</p>
				</div>

				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<Card>
						<CardHeader className="flex-row items-start justify-between gap-3 pb-2">
							<div>
								<CardDescription>{m.operator_metric_assigned_tasks()}</CardDescription>
								<CardTitle className="mt-2 text-3xl">
									{assignedPackets.isLoading ? (
										<Skeleton className="h-9 w-16" />
									) : (
										String(assignedPackets.data?.data.length ?? 0)
									)}
								</CardTitle>
							</div>
							<ListChecks className="text-muted-foreground" aria-hidden="true" />
						</CardHeader>
						<CardContent>
							<Button asChild variant="ghost" size="sm" className="px-0">
								<Link to="/dashboard/production/job-packets">
									{m.dashboard_open_details()} <ArrowRight data-icon="inline-end" />
								</Link>
							</Button>
						</CardContent>
					</Card>

					{can(capabilityList, "labor.attendance.self") ? (
						<Card>
							<CardHeader className="flex-row items-start justify-between gap-3 pb-2">
								<div>
									<CardDescription>{m.operator_metric_attendance()}</CardDescription>
									<CardTitle className="mt-2 text-3xl">
										{attendance.isLoading ? (
											<Skeleton className="h-9 w-16" />
										) : (
											String(attendance.data?.data.length ?? 0)
										)}
									</CardTitle>
								</div>
								<UserCheck className="text-muted-foreground" aria-hidden="true" />
							</CardHeader>
							<CardContent>
								<Button asChild variant="ghost" size="sm" className="px-0">
									<Link to="/dashboard/labor/attendance">
										{m.dashboard_open_details()} <ArrowRight data-icon="inline-end" />
									</Link>
								</Button>
							</CardContent>
						</Card>
					) : null}

					<Card>
						<CardHeader className="flex-row items-start justify-between gap-3 pb-2">
							<div>
								<CardDescription>{m.operator_metric_work_logs()}</CardDescription>
								<CardTitle className="mt-2 text-3xl">
									{workLogs.isLoading ? <Skeleton className="h-9 w-16" /> : String(unpaidLogs)}
								</CardTitle>
							</div>
							<Factory className="text-muted-foreground" aria-hidden="true" />
						</CardHeader>
						<CardContent className="text-sm text-muted-foreground">
							{m.operator_metric_work_logs_description()}
						</CardContent>
					</Card>

					{can(capabilityList, "labor.cash_advance.self") ? (
						<Card>
							<CardHeader className="flex-row items-start justify-between gap-3 pb-2">
								<div>
									<CardDescription>{m.operator_metric_cash_advances()}</CardDescription>
									<CardTitle className="mt-2 text-3xl">
										{cashAdvances.isLoading ? (
											<Skeleton className="h-9 w-16" />
										) : (
											String(openAdvances)
										)}
									</CardTitle>
								</div>
								<WalletCards className="text-muted-foreground" aria-hidden="true" />
							</CardHeader>
						</Card>
					) : null}
				</div>

				<Card>
					<CardHeader>
						<CardTitle>{m.operator_payments_title()}</CardTitle>
						<CardDescription>{m.operator_payments_description()}</CardDescription>
					</CardHeader>
					<CardContent className="text-2xl font-semibold">
						{payments.isLoading ? (
							<Skeleton className="h-8 w-32" />
						) : (
							formatCurrency(
								payments.data?.data.reduce(
									(total, payment) => total + Number(payment.net_paid),
									0,
								) ?? 0,
							)
						)}
					</CardContent>
				</Card>
			</main>
		);
	}

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-2">
				<Badge variant="outline" className="w-fit">
					{m.dashboard_summary_badge()}
				</Badge>
				<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
					{data?.tenant.name ?? m.dashboard_fallback_title()}
				</h1>
				<p className="text-sm text-muted-foreground">{m.dashboard_description()}</p>
			</div>

			{dashboard.isError ? (
				<Alert variant="destructive">
					<AlertTriangle />
					<AlertDescription>{m.dashboard_error()}</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{METRICS.map((metric) => {
					const Icon = metric.icon;
					return (
						<Card key={metric.key}>
							<CardHeader className="flex-row items-start justify-between gap-3 pb-2">
								<div>
									<CardDescription>{metric.label()}</CardDescription>
									<CardTitle className="mt-2 text-3xl">
										{dashboard.isLoading ? (
											<Skeleton className="h-9 w-16" />
										) : (
											String(metric.getValue(data))
										)}
									</CardTitle>
								</div>
								<Icon className="size-5 text-muted-foreground" aria-hidden="true" />
							</CardHeader>
							<CardContent>
								<Button asChild variant="ghost" size="sm" className="px-0">
									<Link to={metric.to}>
										{m.dashboard_open_details()} <ArrowRight data-icon="inline-end" />
									</Link>
								</Button>
							</CardContent>
						</Card>
					);
				})}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.dashboard_receivables_title()}</CardTitle>
					<CardDescription>{m.dashboard_receivables_description()}</CardDescription>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">
					{formatCurrency(data?.receivables ?? 0)}
				</CardContent>
			</Card>
		</main>
	);
}
