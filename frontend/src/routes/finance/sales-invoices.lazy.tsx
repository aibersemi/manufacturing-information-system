import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceIssueCustomerInvoice,
	useBackendApiFinanceListCustomerInvoices,
} from "@/api/generated/finance/finance";
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
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities";
import { splitIdList, trimmedOptional } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { salesInvoicesRoute } from "./sales-invoices";

type CustomerInvoiceRow = {
	id: string;
	invoice_number: string;
	date: string;
	due_date: string | null;
	customer__name: string;
	sales_po__po_number: string;
	total_amount: string;
	amount_paid: string;
	status: string;
};

type CustomerInvoiceListResponse = {
	data: CustomerInvoiceRow[];
	status: number;
	headers: Headers;
};

const invoiceColumns: ColumnDef<CustomerInvoiceRow>[] = [
	{
		accessorKey: "invoice_number",
		header: m.common_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.invoice_number}</span>,
	},
	{ accessorKey: "date", header: m.common_date() },
	{ accessorKey: "customer__name", header: m.sales_invoices_customer() },
	{ accessorKey: "sales_po__po_number", header: m.sales_invoices_po() },
	{
		accessorKey: "total_amount",
		header: m.common_total(),
		cell: ({ row }) => formatCurrency(row.original.total_amount),
	},
	{
		accessorKey: "amount_paid",
		header: m.sales_invoices_paid_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount_paid),
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

const issueInvoiceSchema = z.object({
	deliveryIds: z.string().trim().min(1, m.sales_invoices_delivery_ids_required()),
	dueDate: z.string().trim(),
});

export function SalesInvoicesRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.customer_invoices.read"]}>
			<SalesInvoicesScreen />
		</AccessGuard>
	);
}

function SalesInvoicesScreen() {
	const search = useSearch({ from: salesInvoicesRoute.id });
	const navigate = useNavigate({ from: salesInvoicesRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canIssue = can(capabilityList, "finance.customer_invoices.create");
	const invoices = useBackendApiFinanceListCustomerInvoices<CustomerInvoiceListResponse>();
	const mutation = useBackendApiFinanceIssueCustomerInvoice();
	const isCreateOpen = canIssue && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			deliveryIds: "",
			dueDate: "",
		},
		validators: {
			onChange: issueInvoiceSchema,
			onSubmit: issueInvoiceSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					delivery_ids: splitIdList(value.deliveryIds),
					due_date: trimmedOptional(value.dueDate),
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
					<h1 className="text-2xl font-bold">{m.nav_sales_invoices()}</h1>
					<p className="text-sm text-muted-foreground">{m.sales_invoices_description()}</p>
				</div>
				{canIssue ? (
					<Button type="button" onClick={openCreate}>
						{m.sales_invoices_issue_title()}
					</Button>
				) : null}
			</div>

			{canIssue ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.sales_invoices_issue_title()}
					description={m.sales_invoices_issue_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="deliveryIds">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="sales-invoice-deliveries">
												{m.sales_invoices_delivery_ids()}
											</FieldLabel>
											<Textarea
												id="sales-invoice-deliveries"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												placeholder={m.sales_invoices_delivery_ids_placeholder()}
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
										<FieldLabel htmlFor="sales-invoice-due-date">{m.common_due_date()}</FieldLabel>
										<Input
											id="sales-invoice-due-date"
											name={field.name}
											type="date"
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
											m.sales_invoices_issue()
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
					<CardTitle>{m.sales_invoices_list_title()}</CardTitle>
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
							title={m.sales_invoices_empty_title()}
							description={m.sales_invoices_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
