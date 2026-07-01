import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceCreatePaymentRequest,
	useBackendApiFinanceListPaymentRequests,
} from "@/api/generated/finance/finance";
import type { PaymentRequestResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { decimalInput, trimmedOptional } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { operationalExpensesRoute } from "./expenses";

const expenseColumns: ColumnDef<PaymentRequestResponse>[] = [
	{
		accessorKey: "request_number",
		header: m.common_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.request_number}</span>,
	},
	{ accessorKey: "recipient", header: m.common_recipient() },
	{
		accessorKey: "amount",
		header: m.common_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount),
	},
	{
		accessorKey: "due_date",
		header: m.common_due_date(),
		cell: ({ row }) => row.original.due_date || "—",
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

const expenseSchema = z.object({
	sourceId: z.string().trim().min(1, m.payments_source_id_required()),
	recipient: z.string().trim().min(1, m.payments_recipient_required()),
	amount: z
		.string()
		.trim()
		.min(1, m.payments_amount_required())
		.refine((value) => decimalInput(value) > 0, { message: m.payments_amount_positive() }),
	dueDate: z.string().trim(),
	proofId: z.string().trim(),
});

export function OperationalExpensesRouteScreen() {
	return (
		<AccessGuard anyOf={["reports.finance.read", "finance.payment_requests.read"]}>
			<OperationalExpensesScreen />
		</AccessGuard>
	);
}

function OperationalExpensesScreen() {
	const search = useSearch({ from: operationalExpensesRoute.id });
	const navigate = useNavigate({ from: operationalExpensesRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canCreate = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"finance.payment_requests.create",
	);
	const requests = useBackendApiFinanceListPaymentRequests();
	const expenses =
		requests.data?.data.filter((request) => request.request_type === "expense") ?? [];
	const mutation = useBackendApiFinanceCreatePaymentRequest();
	const isCreateOpen = canCreate && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			sourceId: "",
			recipient: "",
			amount: "",
			dueDate: "",
			proofId: "",
		},
		validators: {
			onChange: expenseSchema,
			onSubmit: expenseSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					request_type: "expense",
					source_type: "expense",
					source_id: value.sourceId,
					amount: decimalInput(value.amount),
					recipient: value.recipient,
					due_date: trimmedOptional(value.dueDate),
					proof_id: trimmedOptional(value.proofId),
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: requests.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_operational_expenses()}</h1>
					<p className="text-sm text-muted-foreground">{m.operational_expenses_description()}</p>
				</div>
				{canCreate ? (
					<Button type="button" onClick={openCreate}>
						{m.operational_expenses_create_title()}
					</Button>
				) : null}
			</div>

			{canCreate ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.operational_expenses_create_title()}
					description={m.operational_expenses_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="sourceId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="expense-source">
												{m.operational_expenses_reference()}
											</FieldLabel>
											<Input
												id="expense-source"
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
							<form.Field name="recipient">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="expense-recipient">{m.common_recipient()}</FieldLabel>
											<Input
												id="expense-recipient"
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
							<form.Field name="amount">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="expense-amount">{m.common_amount()}</FieldLabel>
											<Input
												id="expense-amount"
												name={field.name}
												type="text"
												inputMode="decimal"
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
							<form.Field name="dueDate">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="expense-due-date">{m.common_due_date()}</FieldLabel>
										<Input
											id="expense-due-date"
											name={field.name}
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</Field>
								)}
							</form.Field>
							<form.Field name="proofId">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="expense-proof">
											{m.purchase_payments_proof_id()}
										</FieldLabel>
										<Input
											id="expense-proof"
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
											m.operational_expenses_submit()
										)}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</ActionSheet>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>{m.operational_expenses_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{requests.isLoading ? (
						<DataLoading />
					) : requests.isError ? (
						<DataError onRetry={() => void requests.refetch()} />
					) : expenses.length ? (
						<DataTable columns={expenseColumns} data={expenses} getRowId={(row) => row.id} />
					) : (
						<DataEmpty
							title={m.operational_expenses_empty_title()}
							description={m.operational_expenses_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
