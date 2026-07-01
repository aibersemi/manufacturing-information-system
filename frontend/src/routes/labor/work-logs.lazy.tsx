import type { ColumnDef } from "@tanstack/react-table";

import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import { useBackendApiLaborListOwnWorkLogs } from "@/api/generated/labor/labor";
import type { OperatorWorkLogResponse, WorkLogResponse } from "@/api/generated/models";
import { useBackendApiProductionListWorkLogs } from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, canAny } from "@/lib/capabilities";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import * as m from "@/paraglide/messages";

const ownWorkLogColumns: ColumnDef<OperatorWorkLogResponse>[] = [
	{ accessorKey: "job_packet_id", header: m.operator_work_logs_job_packet() },
	{
		accessorKey: "qty_claimed",
		header: m.operator_work_logs_claimed_qty(),
		cell: ({ row }) => formatNumberId(row.original.qty_claimed),
	},
	{
		accessorKey: "piece_rate_applied",
		header: m.piece_rates_rate_amount(),
		cell: ({ row }) => formatCurrency(row.original.piece_rate_applied),
	},
	{
		accessorKey: "amount_total",
		header: m.common_total(),
		cell: ({ row }) => formatCurrency(row.original.amount_total),
	},
	{
		accessorKey: "is_verified",
		header: m.operator_work_logs_verified(),
		cell: ({ row }) => (
			<Badge variant={row.original.is_verified ? "secondary" : "outline"}>
				{row.original.is_verified ? m.common_yes() : m.common_no()}
			</Badge>
		),
	},
	{
		accessorKey: "is_paid",
		header: m.operator_work_logs_paid(),
		cell: ({ row }) => (
			<Badge variant={row.original.is_paid ? "secondary" : "outline"}>
				{row.original.is_paid ? m.common_yes() : m.common_no()}
			</Badge>
		),
	},
];

const reviewWorkLogColumns: ColumnDef<WorkLogResponse>[] = [
	{ accessorKey: "operator_id", header: m.common_operator() },
	{
		accessorKey: "qty_claimed",
		header: m.operator_work_logs_claimed_qty(),
		cell: ({ row }) => formatNumberId(row.original.qty_claimed),
	},
	{
		accessorKey: "piece_rate_applied",
		header: m.piece_rates_rate_amount(),
		cell: ({ row }) => formatCurrency(row.original.piece_rate_applied),
	},
	{
		accessorKey: "amount_total",
		header: m.common_total(),
		cell: ({ row }) => formatCurrency(row.original.amount_total),
	},
	{
		accessorKey: "is_verified",
		header: m.operator_work_logs_verified(),
		cell: ({ row }) => (
			<Badge variant={row.original.is_verified ? "secondary" : "outline"}>
				{row.original.is_verified ? m.common_yes() : m.common_no()}
			</Badge>
		),
	},
	{
		accessorKey: "is_paid",
		header: m.operator_work_logs_paid(),
		cell: ({ row }) => (
			<Badge variant={row.original.is_paid ? "secondary" : "outline"}>
				{row.original.is_paid ? m.common_yes() : m.common_no()}
			</Badge>
		),
	},
];

export function OperatorWorkLogsRouteScreen() {
	return (
		<AccessGuard
			anyOf={[
				"labor.work_log.self",
				"production.progress.verify",
				"labor.piece_rate.pay",
				"reports.operational.read",
			]}
		>
			<OperatorWorkLogsScreen />
		</AccessGuard>
	);
}

function OperatorWorkLogsScreen() {
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canSelf = can(capabilityList, "labor.work_log.self");
	const canReview = canAny(capabilityList, [
		"production.progress.verify",
		"labor.piece_rate.pay",
		"reports.operational.read",
	]);
	const ownLogs = useBackendApiLaborListOwnWorkLogs({
		query: { enabled: canSelf },
	});
	const reviewLogs = useBackendApiProductionListWorkLogs(undefined, {
		query: { enabled: canReview },
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div>
				<h1 className="text-2xl font-bold">{m.nav_operator_work_logs()}</h1>
				<p className="text-sm text-muted-foreground">{m.operator_work_logs_description()}</p>
			</div>

			{canSelf ? (
				<Card>
					<CardHeader>
						<CardTitle>{m.operator_work_logs_own_title()}</CardTitle>
					</CardHeader>
					<CardContent>
						{ownLogs.isLoading ? (
							<DataLoading />
						) : ownLogs.isError ? (
							<DataError onRetry={() => void ownLogs.refetch()} />
						) : ownLogs.data?.data.length ? (
							<DataTable
								columns={ownWorkLogColumns}
								data={ownLogs.data.data}
								getRowId={(row) => row.id}
							/>
						) : (
							<DataEmpty
								title={m.operator_work_logs_empty_title()}
								description={m.operator_work_logs_empty_description()}
							/>
						)}
					</CardContent>
				</Card>
			) : null}

			{canReview ? (
				<Card>
					<CardHeader>
						<CardTitle>{m.operator_work_logs_review_title()}</CardTitle>
					</CardHeader>
					<CardContent>
						{reviewLogs.isLoading ? (
							<DataLoading />
						) : reviewLogs.isError ? (
							<DataError onRetry={() => void reviewLogs.refetch()} />
						) : reviewLogs.data?.data.length ? (
							<DataTable
								columns={reviewWorkLogColumns}
								data={reviewLogs.data.data}
								getRowId={(row) => row.id}
							/>
						) : (
							<DataEmpty
								title={m.operator_work_logs_empty_title()}
								description={m.operator_work_logs_empty_description()}
							/>
						)}
					</CardContent>
				</Card>
			) : null}
		</main>
	);
}
