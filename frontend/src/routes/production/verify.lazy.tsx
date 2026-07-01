import { useForm } from "@tanstack/react-form";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";

import type { WorkLogResponse } from "@/api/generated/models";
import {
	useBackendApiProductionListWorkLogs,
	useBackendApiProductionVerifyProgress,
} from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { isOptionalJsonObject, parseOptionalJsonObject } from "@/lib/form-values";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";

const pendingColumns: ColumnDef<WorkLogResponse>[] = [
	{ accessorKey: "id", header: m.common_id() },
	{ accessorKey: "operator_id", header: m.common_operator() },
	{
		accessorKey: "qty_claimed",
		header: m.operator_work_logs_claimed_qty(),
		cell: ({ row }) => formatNumberId(row.original.qty_claimed),
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
];

const verifySchema = z.object({
	progressId: z.string().trim().min(1, m.progress_verification_progress_required()),
	reason: z.string().trim(),
	correctionJson: z
		.string()
		.trim()
		.refine(isOptionalJsonObject, { message: m.progress_verification_correction_invalid() }),
});

export function ProgressVerificationRouteScreen() {
	return (
		<AccessGuard anyOf={["production.progress.verify"]}>
			<ProgressVerificationScreen />
		</AccessGuard>
	);
}

function ProgressVerificationScreen() {
	const pendingLogs = useBackendApiProductionListWorkLogs({
		is_verified: false,
	});
	const mutation = useBackendApiProductionVerifyProgress();
	const form = useForm({
		defaultValues: {
			progressId: "",
			reason: "",
			correctionJson: "",
		},
		validators: {
			onChange: verifySchema,
			onSubmit: verifySchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				progressId: value.progressId,
				data: {
					reason: value.reason,
					correction: parseOptionalJsonObject(value.correctionJson),
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: pendingLogs.queryKey });
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div>
				<h1 className="text-2xl font-bold">{m.nav_progress_verification()}</h1>
				<p className="text-sm text-muted-foreground">{m.progress_verification_description()}</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.progress_verification_verify_title()}</CardTitle>
					<CardDescription>{m.progress_verification_verify_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="grid gap-4 md:grid-cols-2">
							<form.Field name="progressId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="verify-progress-id">
												{m.progress_verification_progress_id()}
											</FieldLabel>
											<Input
												id="verify-progress-id"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
												required
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="reason">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="verify-reason">{m.common_reason()}</FieldLabel>
										<Input
											id="verify-reason"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</Field>
								)}
							</form.Field>
							<form.Field name="correctionJson">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid} className="md:col-span-2">
											<FieldLabel htmlFor="verify-correction">
												{m.progress_verification_correction_json()}
											</FieldLabel>
											<Textarea
												id="verify-correction"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												placeholder={m.progress_verification_correction_placeholder()}
												aria-invalid={invalid}
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Subscribe selector={(state) => state.isSubmitting}>
								{(isSubmitting) => (
									<Button
										type="submit"
										className="md:w-fit"
										disabled={isSubmitting || mutation.isPending}
									>
										{mutation.isPending ? (
											<>
												<Spinner data-icon="inline-start" />
												{m.common_saving()}
											</>
										) : (
											m.progress_verification_submit()
										)}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{m.progress_verification_pending_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{pendingLogs.isLoading ? (
						<DataLoading />
					) : pendingLogs.isError ? (
						<DataError onRetry={() => void pendingLogs.refetch()} />
					) : pendingLogs.data?.data.length ? (
						<DataTable
							columns={pendingColumns}
							data={pendingLogs.data.data}
							getRowId={(row) => row.id}
						/>
					) : (
						<DataEmpty
							title={m.progress_verification_empty_title()}
							description={m.progress_verification_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
