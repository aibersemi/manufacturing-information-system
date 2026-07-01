import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceListSupplierInvoices,
	useBackendApiFinancePayInvoice,
} from "@/api/generated/finance/finance";
import { useBackendApiMasterdataListBankAccounts } from "@/api/generated/master-data/master-data";
import type { SupplierInvoiceResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { decimalInput, todayInputDate, trimmedOptional } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { purchasePaymentsRoute } from "./purchase-payments";

const invoiceColumns: ColumnDef<SupplierInvoiceResponse>[] = [
	{
		accessorKey: "invoice_number",
		header: m.common_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.invoice_number}</span>,
	},
	{ accessorKey: "date", header: m.common_date() },
	{
		accessorKey: "total_amount",
		header: m.common_total(),
		cell: ({ row }) => formatCurrency(row.original.total_amount),
	},
	{
		accessorKey: "amount_paid",
		header: m.purchase_invoices_paid_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount_paid),
	},
	{
		id: "outstanding",
		header: m.purchase_payments_outstanding(),
		cell: ({ row }) =>
			formatCurrency(Number(row.original.total_amount) - Number(row.original.amount_paid)),
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

const paymentSchema = z.object({
	invoiceId: z.string().trim().min(1, m.purchase_payments_invoice_required()),
	accountId: z.string().trim().min(1, m.purchase_payments_account_required()),
	paymentDate: z.string().trim().min(1, m.common_effective_date_required()),
	amount: z
		.string()
		.trim()
		.min(1, m.payments_amount_required())
		.refine((value) => decimalInput(value) > 0, { message: m.payments_amount_positive() }),
	reference: z.string().trim(),
	proofId: z.string().trim(),
});

export function PurchasePaymentsRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.supplier_invoices.read", "finance.supplier_invoices.pay"]}>
			<PurchasePaymentsScreen />
		</AccessGuard>
	);
}

function PurchasePaymentsScreen() {
	const search = useSearch({ from: purchasePaymentsRoute.id });
	const navigate = useNavigate({ from: purchasePaymentsRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canPay = can(capabilityList, "finance.supplier_invoices.pay");
	const invoices = useBackendApiFinanceListSupplierInvoices();
	const accounts = useBackendApiMasterdataListBankAccounts();
	const mutation = useBackendApiFinancePayInvoice();
	const payableInvoices = invoices.data?.data.filter((invoice) => invoice.status !== "paid") ?? [];
	const isCreateOpen = canPay && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			invoiceId: "",
			accountId: "",
			paymentDate: todayInputDate(),
			amount: "",
			reference: "",
			proofId: "",
		},
		validators: {
			onChange: paymentSchema,
			onSubmit: paymentSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				invoiceId: value.invoiceId,
				data: {
					account_id: value.accountId,
					payment_date: value.paymentDate,
					amount: decimalInput(value.amount),
					reference: value.reference,
					proof_id: trimmedOptional(value.proofId),
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: invoices.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_purchase_payments()}</h1>
					<p className="text-sm text-muted-foreground">{m.purchase_payments_description()}</p>
				</div>
				{canPay ? (
					<Button type="button" onClick={openCreate}>
						{m.purchase_payments_create_title()}
					</Button>
				) : null}
			</div>

			{canPay ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.purchase_payments_create_title()}
					description={m.purchase_payments_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="invoiceId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="purchase-payment-invoice">
												{m.purchase_payments_invoice()}
											</FieldLabel>
											<NativeSelect
												id="purchase-payment-invoice"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.purchase_payments_select_invoice()}
												</NativeSelectOption>
												{payableInvoices.map((invoice) => (
													<NativeSelectOption key={invoice.id} value={invoice.id}>
														{invoice.invoice_number}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="accountId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="purchase-payment-account">
												{m.purchase_payments_account()}
											</FieldLabel>
											<NativeSelect
												id="purchase-payment-account"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.purchase_payments_select_account()}
												</NativeSelectOption>
												{accounts.data?.data.map((account) => (
													<NativeSelectOption key={account.id} value={account.id}>
														{account.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="paymentDate">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="purchase-payment-date">{m.common_date()}</FieldLabel>
											<Input
												id="purchase-payment-date"
												name={field.name}
												type="date"
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
											<FieldLabel htmlFor="purchase-payment-amount">{m.common_amount()}</FieldLabel>
											<Input
												id="purchase-payment-amount"
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
							<form.Field name="reference">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="purchase-payment-reference">
											{m.common_reference()}
										</FieldLabel>
										<Input
											id="purchase-payment-reference"
											name={field.name}
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
										<FieldLabel htmlFor="purchase-payment-proof">
											{m.purchase_payments_proof_id()}
										</FieldLabel>
										<Input
											id="purchase-payment-proof"
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
											m.purchase_payments_pay()
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
					<CardTitle>{m.purchase_payments_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{invoices.isLoading ? (
						<DataLoading />
					) : invoices.isError ? (
						<DataError onRetry={() => void invoices.refetch()} />
					) : invoices.data?.data.length ? (
						<DataTable
							columns={invoiceColumns}
							data={invoices.data.data}
							getRowId={(row) => row.id}
						/>
					) : (
						<DataEmpty
							title={m.purchase_payments_empty_title()}
							description={m.purchase_payments_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
