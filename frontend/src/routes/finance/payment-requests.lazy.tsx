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
import type { PaymentRequestPayload } from "@/api/generated/models/paymentRequestPayload";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { can } from "@/lib/capabilities";
import { decimalInput } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { paymentRequestsRoute } from "./payment-requests";

const columns: ColumnDef<PaymentRequestResponse>[] = [
	{ accessorKey: "request_number", header: m.common_number() },
	{ accessorKey: "request_type", header: m.common_type() },
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
	{ accessorKey: "status", header: m.common_status() },
];

const paymentRequestFormSchema = z.object({
	requestType: z.enum(["supplier", "operator", "outsource", "asset", "expense"]),
	sourceType: z.string().trim().min(1, m.payments_source_document_required()),
	sourceId: z.string().trim().min(1, m.payments_source_id_required()),
	recipient: z.string().trim().min(1, m.payments_recipient_required()),
	amount: z
		.string()
		.trim()
		.min(1, m.payments_amount_required())
		.refine(
			(value) => {
				const amount = decimalInput(value);
				return Number.isFinite(amount) && amount > 0;
			},
			{ message: m.payments_amount_positive() },
		),
	dueDate: z.string().trim(),
});

function optionalString(value: string): string | undefined {
	return value || undefined;
}

function toPaymentRequestPayload(value: unknown): PaymentRequestPayload {
	const parsed = paymentRequestFormSchema.parse(value);
	return {
		request_type: parsed.requestType,
		source_type: parsed.sourceType,
		source_id: parsed.sourceId,
		amount: decimalInput(parsed.amount),
		recipient: parsed.recipient,
		due_date: optionalString(parsed.dueDate),
	};
}

export function PaymentRequestsRouteScreen() {
	return (
		<AccessGuard
			anyOf={[
				"finance.payment_requests.read",
				"finance.payment_requests.create",
				"finance.payment_requests.pay",
			]}
		>
			<PaymentRequestsScreen />
		</AccessGuard>
	);
}

function PaymentRequestsScreen() {
	const search = useSearch({ from: paymentRequestsRoute.id });
	const navigate = useNavigate({ from: paymentRequestsRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canCreate = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"finance.payment_requests.create",
	);
	const requests = useBackendApiFinanceListPaymentRequests();
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
			requestType: "supplier",
			sourceType: "",
			sourceId: "",
			recipient: "",
			amount: "",
			dueDate: "",
		},
		validators: {
			onChange: paymentRequestFormSchema,
			onSubmit: paymentRequestFormSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({ data: toPaymentRequestPayload(value) });
			form.reset();
			await queryClient.invalidateQueries({ queryKey: requests.queryKey });
			closeCreate();
		},
	});
	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.payments_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.payments_description()}</p>
				</div>
				{canCreate ? (
					<Button type="button" onClick={openCreate}>
						{m.payments_create_title()}
					</Button>
				) : null}
			</div>
			{canCreate ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.payments_create_title()}
					description={m.payments_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="requestType">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="pay-type">{m.common_type()}</FieldLabel>
											<NativeSelect
												id="pay-type"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
											>
												<NativeSelectOption value="supplier">
													{m.payments_supplier()}
												</NativeSelectOption>
												<NativeSelectOption value="operator">
													{m.payments_operator()}
												</NativeSelectOption>
												<NativeSelectOption value="outsource">
													{m.payments_outsource()}
												</NativeSelectOption>
												<NativeSelectOption value="asset">{m.payments_asset()}</NativeSelectOption>
												<NativeSelectOption value="expense">
													{m.payments_expense()}
												</NativeSelectOption>
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="sourceType">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="pay-source-type">
												{m.payments_source_document()}
											</FieldLabel>
											<Input
												id="pay-source-type"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												placeholder={m.payments_source_document_placeholder()}
												required
												aria-invalid={invalid}
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="sourceId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="pay-source-id">{m.payments_source_id()}</FieldLabel>
											<Input
												id="pay-source-id"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												required
												aria-invalid={invalid}
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
											<FieldLabel htmlFor="pay-recipient">{m.common_recipient()}</FieldLabel>
											<Input
												id="pay-recipient"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												required
												aria-invalid={invalid}
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
											<FieldLabel htmlFor="pay-amount">{m.common_amount()}</FieldLabel>
											<Input
												id="pay-amount"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												type="text"
												inputMode="decimal"
												required
												aria-invalid={invalid}
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="dueDate">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="pay-due">{m.common_due_date()}</FieldLabel>
										<Input
											id="pay-due"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											type="date"
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
										{m.payments_submit()}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</ActionSheet>
			) : null}
			<Card>
				<CardHeader>
					<CardTitle>{m.payments_status_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{requests.isLoading ? (
						<DataLoading />
					) : requests.isError ? (
						<DataError onRetry={() => void requests.refetch()} />
					) : requests.data?.data.length ? (
						<DataTable columns={columns} data={requests.data.data} getRowId={(row) => row.id} />
					) : (
						<DataEmpty
							title={m.payments_empty_title()}
							description={m.payments_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
