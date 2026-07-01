import type { ColumnDef } from "@tanstack/react-table";

import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiCoreListApprovals,
	useBackendApiCoreListAuditEvents,
	useBackendApiCoreListNotifications,
} from "@/api/generated/core/core";
import type { ApprovalResponse, AuditResponse, NotificationResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/capabilities";
import { formatDateTime } from "@/lib/i18n";
import * as m from "@/paraglide/messages";

const notificationColumns: ColumnDef<NotificationResponse>[] = [
	{
		accessorKey: "created_at",
		header: m.common_time(),
		cell: ({ row }) => formatDateTime(row.original.created_at),
	},
	{ accessorKey: "title", header: m.control_notification() },
	{ accessorKey: "message", header: m.control_summary() },
	{ accessorKey: "status", header: m.common_status() },
];
const approvalColumns: ColumnDef<ApprovalResponse>[] = [
	{
		accessorKey: "created_at",
		header: m.common_time(),
		cell: ({ row }) => formatDateTime(row.original.created_at),
	},
	{ accessorKey: "action_type", header: m.common_action() },
	{ accessorKey: "resource_type", header: m.common_object() },
	{ accessorKey: "reason", header: m.common_reason() },
	{ accessorKey: "status", header: m.common_status() },
];
const auditColumns: ColumnDef<AuditResponse>[] = [
	{
		accessorKey: "created_at",
		header: m.common_time(),
		cell: ({ row }) => formatDateTime(row.original.created_at),
	},
	{ accessorKey: "action", header: m.common_action() },
	{ accessorKey: "resource_type", header: m.common_object() },
	{ accessorKey: "resource_id", header: m.common_id() },
	{ accessorKey: "request_id", header: m.common_request_id() },
];

export function ControlCenterRouteScreen() {
	return (
		<AccessGuard
			anyOf={[
				"core.notifications.read",
				"core.audit.read",
				"core.audit.self",
				"core.approvals.read",
			]}
		>
			<ControlCenter />
		</AccessGuard>
	);
}

function DataCard<T>({
	title,
	description,
	query,
	columns,
	getId,
}: {
	title: string;
	description: string;
	query: { isLoading: boolean; isError: boolean; data?: { data: T[] }; refetch: () => unknown };
	columns: ColumnDef<T>[];
	getId: (row: T) => string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isLoading ? (
					<DataLoading />
				) : query.isError ? (
					<DataError onRetry={() => void query.refetch()} />
				) : query.data?.data.length ? (
					<div className="overflow-x-auto">
						<DataTable columns={columns} data={query.data.data} getRowId={getId} />
					</div>
				) : (
					<DataEmpty
						title={m.control_empty_title({ title: title.toLowerCase() })}
						description={m.control_empty_description()}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function ControlCenter() {
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canReadNotifications = can(capabilityList, "core.notifications.read");
	const canReadApprovals = can(capabilityList, "core.approvals.read");
	const canReadAudit =
		can(capabilityList, "core.audit.read") || can(capabilityList, "core.audit.self");
	const notifications = useBackendApiCoreListNotifications(undefined, {
		query: { enabled: canReadNotifications },
	});
	const approvals = useBackendApiCoreListApprovals(undefined, {
		query: { enabled: canReadApprovals },
	});
	const audit = useBackendApiCoreListAuditEvents(
		{ limit: 100 },
		{ query: { enabled: canReadAudit } },
	);
	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div>
				<h1 className="text-2xl font-bold">{m.control_title()}</h1>
				<p className="text-sm text-muted-foreground">{m.control_description()}</p>
			</div>
			{canReadNotifications ? (
				<DataCard
					title={m.control_notification()}
					description={m.control_notifications_description()}
					query={notifications}
					columns={notificationColumns}
					getId={(row) => row.id}
				/>
			) : null}
			{canReadApprovals ? (
				<DataCard
					title={m.control_approval()}
					description={m.control_approvals_description()}
					query={approvals}
					columns={approvalColumns}
					getId={(row) => row.id}
				/>
			) : null}
			{canReadAudit ? (
				<DataCard
					title={m.control_audit_trail()}
					description={m.control_audit_description()}
					query={audit}
					columns={auditColumns}
					getId={(row) => String(row.id)}
				/>
			) : null}
		</main>
	);
}
