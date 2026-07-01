import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiLaborListAttendance,
	useBackendApiLaborRecordAttendance,
} from "@/api/generated/labor/labor";
import { useBackendApiMasterdataListOperators } from "@/api/generated/master-data/master-data";
import type { AttendanceResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { can } from "@/lib/capabilities";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { attendanceRoute } from "./attendance";

const columns: ColumnDef<AttendanceResponse>[] = [
	{ accessorKey: "date", header: m.common_date() },
	{ accessorKey: "operator_name", header: m.attendance_operator() },
	{
		accessorKey: "is_present",
		header: m.common_status(),
		cell: ({ row }) => (row.original.is_present ? m.attendance_present() : m.attendance_absent()),
	},
	{ accessorKey: "notes", header: m.common_notes(), cell: ({ row }) => row.original.notes || "—" },
];

export function AttendanceRouteScreen() {
	return (
		<AccessGuard anyOf={["labor.attendance.read", "labor.attendance.self"]}>
			<AttendanceScreen />
		</AccessGuard>
	);
}

function AttendanceScreen() {
	const search = useSearch({ from: attendanceRoute.id });
	const navigate = useNavigate({ from: attendanceRoute.id });
	const session = useBackendApiAuthGetCapabilities();
	const capabilityList = session.data?.status === 200 ? session.data.data.capabilities : undefined;
	const canManage = can(capabilityList, "labor.attendance.create");
	const isSelfAttendance = can(capabilityList, "labor.attendance.self") && !canManage;
	const attendance = useBackendApiLaborListAttendance();
	const operators = useBackendApiMasterdataListOperators({
		query: { enabled: canManage },
	});
	const mutation = useBackendApiLaborRecordAttendance();
	const isCreateOpen = search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: { operatorId: "", date: "", isPresent: "true", notes: "" },
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					operator_id: value.operatorId,
					date: value.date,
					is_present: value.isPresent === "true",
					notes: value.notes,
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: attendance.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.attendance_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.attendance_description()}</p>
				</div>
				<Button type="button" onClick={openCreate}>
					{m.attendance_create_title()}
				</Button>
			</div>
			<ActionSheet
				open={isCreateOpen}
				onOpenChange={(open) => {
					if (!open) closeCreate();
				}}
				title={m.attendance_create_title()}
				description={m.attendance_create_description()}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<FieldGroup className="gap-4">
						{isSelfAttendance ? null : (
							<form.Field name="operatorId">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="attendance-operator">{m.attendance_operator()}</FieldLabel>
										<NativeSelect
											id="attendance-operator"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											className="w-full"
											required
										>
											<NativeSelectOption value="">
												{m.attendance_select_operator()}
											</NativeSelectOption>
											{operators.data?.data.map((operator) => (
												<NativeSelectOption key={operator.id} value={operator.id}>
													{operator.name}
												</NativeSelectOption>
											))}
										</NativeSelect>
									</Field>
								)}
							</form.Field>
						)}
						<form.Field name="date">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="attendance-date">{m.common_date()}</FieldLabel>
									<Input
										id="attendance-date"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										type="date"
										required
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="isPresent">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="attendance-status">{m.common_status()}</FieldLabel>
									<NativeSelect
										id="attendance-status"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										className="w-full"
									>
										<NativeSelectOption value="true">{m.attendance_present()}</NativeSelectOption>
										<NativeSelectOption value="false">{m.attendance_absent()}</NativeSelectOption>
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="notes">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="attendance-notes">{m.common_notes()}</FieldLabel>
									<Input
										id="attendance-notes"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</Field>
							)}
						</form.Field>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button
									className="md:col-span-4 md:w-fit"
									type="submit"
									disabled={isSubmitting || mutation.isPending}
								>
									{m.attendance_submit()}
								</Button>
							)}
						</form.Subscribe>
					</FieldGroup>
				</form>
			</ActionSheet>
			<Card>
				<CardHeader>
					<CardTitle>{m.attendance_history()}</CardTitle>
				</CardHeader>
				<CardContent>
					{attendance.isLoading ? (
						<DataLoading />
					) : attendance.isError ? (
						<DataError onRetry={() => void attendance.refetch()} />
					) : attendance.data?.data.length ? (
						<DataTable columns={columns} data={attendance.data.data} getRowId={(row) => row.id} />
					) : (
						<DataEmpty
							title={m.attendance_empty_title()}
							description={m.attendance_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
