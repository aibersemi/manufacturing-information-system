import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceCreateSupplierInvoice,
	useBackendApiFinanceListSupplierInvoices,
} from "@/api/generated/finance/finance";
import { useBackendApiInventoryListPurchaseOrders } from "@/api/generated/inventory/inventory";
import { useBackendApiMasterdataListMaterials } from "@/api/generated/master-data/master-data";
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
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { purchaseInvoicesRoute } from "./purchase-invoices";

const supplierInvoiceColumns: ColumnDef<SupplierInvoiceResponse>[] = [
	{
		accessorKey: "invoice_number",
		header: m.common_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.invoice_number}</span>,
	},
	{ accessorKey: "date", header: m.common_date() },
	{
		accessorKey: "due_date",
		header: m.common_due_date(),
		cell: ({ row }) => row.original.due_date || "—",
	},
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
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

const supplierInvoiceSchema = z.object({
	purchaseOrderId: z.string().trim().min(1, m.purchase_invoices_po_required()),
	invoiceNumber: z.string().trim().min(1, m.purchase_invoices_number_required()),
	date: z.string().trim().min(1, m.common_effective_date_required()),
	dueDate: z.string().trim(),
});

export function PurchaseInvoicesRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.supplier_invoices.read"]}>
			<PurchaseInvoicesScreen />
		</AccessGuard>
	);
}

function PurchaseInvoicesScreen() {
	const search = useSearch({ from: purchaseInvoicesRoute.id });
	const navigate = useNavigate({ from: purchaseInvoicesRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "finance.supplier_invoices.create");
	const invoices = useBackendApiFinanceListSupplierInvoices();
	const purchaseOrders = useBackendApiInventoryListPurchaseOrders();
	const materials = useBackendApiMasterdataListMaterials();
	const mutation = useBackendApiFinanceCreateSupplierInvoice();
	const linePriceStore = useMemo(() => new Store({ prices: {} as Record<string, string> }), []);
	const { prices: linePrices } = useStore(linePriceStore);
	const setLinePrices = (
		next: Record<string, string> | ((current: Record<string, string>) => Record<string, string>),
	) => {
		linePriceStore.setState((state) => ({
			prices: typeof next === "function" ? next(state.prices) : next,
		}));
	};
	const materialById = useMemo(
		() => new Map((materials.data?.data || []).map((material) => [material.id, material])),
		[materials.data?.data],
	);
	const isCreateOpen = canCreate && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		setLinePrices({});
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const defaultLinePrices = (purchaseOrderId: string) => {
		const selectedPo = purchaseOrders.data?.data.find((order) => order.id === purchaseOrderId);
		return Object.fromEntries(
			(selectedPo?.lines || []).map((line) => {
				const material = materialById.get(line.material_id);
				return [line.id, line.unit_price || material?.last_purchase_price || ""];
			}),
		);
	};
	const form = useForm({
		defaultValues: {
			purchaseOrderId: "",
			invoiceNumber: "",
			date: todayInputDate(),
			dueDate: "",
		},
		validators: {
			onChange: supplierInvoiceSchema,
			onSubmit: supplierInvoiceSchema,
		},
		onSubmit: async ({ value }) => {
			const selectedPo = purchaseOrders.data?.data.find(
				(order) => order.id === value.purchaseOrderId,
			);
			const invoiceableLines = (selectedPo?.lines || []).filter(
				(line) => decimalInput(String(line.received_qty)) > 0,
			);
			if (!selectedPo || invoiceableLines.length === 0) {
				toast.error(m.purchase_invoices_po_required());
				return;
			}
			const lines = [];
			for (const line of invoiceableLines) {
				const unitPrice = decimalInput(linePrices[line.id] || "");
				if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
					toast.error(m.purchase_invoices_unit_price_required());
					return;
				}
				lines.push({
					purchase_order_line_id: line.id,
					quantity: decimalInput(String(line.received_qty)),
					unit_price: unitPrice,
				});
			}
			await mutation.mutateAsync({
				data: {
					purchase_order_id: value.purchaseOrderId,
					invoice_number: value.invoiceNumber,
					date: value.date,
					due_date: trimmedOptional(value.dueDate),
					lines,
				},
			});
			form.reset();
			setLinePrices({});
			await queryClient.invalidateQueries({ queryKey: invoices.queryKey });
			await queryClient.invalidateQueries({ queryKey: materials.queryKey });
			await queryClient.invalidateQueries({ queryKey: purchaseOrders.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_purchase_invoices()}</h1>
					<p className="text-sm text-muted-foreground">{m.purchase_invoices_description()}</p>
				</div>
				{canCreate ? (
					<Button type="button" onClick={openCreate}>
						{m.purchase_invoices_create_title()}
					</Button>
				) : null}
			</div>

			{canCreate ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.purchase_invoices_create_title()}
					description={m.purchase_invoices_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="purchaseOrderId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="supplier-invoice-po">
												{m.purchase_invoices_po()}
											</FieldLabel>
											<NativeSelect
												id="supplier-invoice-po"
												name={field.name}
												value={field.state.value}
												onChange={(event) => {
													const value = event.target.value;
													field.handleChange(value);
													setLinePrices(defaultLinePrices(value));
												}}
												onBlur={field.handleBlur}
												className="w-full"
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.purchase_invoices_select_po()}
												</NativeSelectOption>
												{purchaseOrders.data?.data.map((order) => (
													<NativeSelectOption key={order.id} value={order.id}>
														{order.po_number}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="invoiceNumber">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="supplier-invoice-number">
												{m.purchase_invoices_number()}
											</FieldLabel>
											<Input
												id="supplier-invoice-number"
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
							<form.Field name="date">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="supplier-invoice-date">{m.common_date()}</FieldLabel>
											<Input
												id="supplier-invoice-date"
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
							<form.Field name="dueDate">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="supplier-invoice-due-date">
											{m.common_due_date()}
										</FieldLabel>
										<Input
											id="supplier-invoice-due-date"
											name={field.name}
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</Field>
								)}
							</form.Field>
							<form.Subscribe selector={(state) => state.values.purchaseOrderId}>
								{(purchaseOrderId) => {
									const selectedPo = purchaseOrders.data?.data.find(
										(order) => order.id === purchaseOrderId,
									);
									const invoiceableLines = (selectedPo?.lines || []).filter(
										(line) => decimalInput(String(line.received_qty)) > 0,
									);
									const totalAmount = invoiceableLines.reduce((total, line) => {
										const unitPrice = decimalInput(linePrices[line.id] || "0");
										return Number.isFinite(unitPrice)
											? total + decimalInput(String(line.received_qty)) * unitPrice
											: total;
									}, 0);

									return selectedPo ? (
										<div className="flex flex-col gap-3 rounded-md border p-4">
											<div className="hidden gap-3 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_120px_160px]">
												<span>{m.purchase_invoices_po_line_material()}</span>
												<span>{m.purchase_invoices_po_line_quantity()}</span>
												<span>{m.purchase_invoices_po_line_unit_price()}</span>
											</div>
											{invoiceableLines.map((line) => {
												const material = materialById.get(line.material_id);
												return (
													<div
														key={line.id}
														className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_160px] sm:items-center sm:gap-3"
													>
														<span className="text-sm font-medium">
															{material?.name || line.material_id}
														</span>
														<span className="text-sm text-muted-foreground">
															{formatNumberId(line.received_qty, {
																maximumFractionDigits: 4,
															})}
														</span>
														<Input
															type="text"
															inputMode="decimal"
															value={linePrices[line.id] || ""}
															onChange={(event) =>
																setLinePrices((current) => ({
																	...current,
																	[line.id]: event.target.value,
																}))
															}
															aria-label={`${m.purchase_invoices_po_line_unit_price()} ${
																material?.name || line.material_id
															}`}
														/>
													</div>
												);
											})}
											<div className="flex items-center justify-between border-t pt-3 text-sm font-semibold">
												<span>{m.purchase_invoices_total_calculated()}</span>
												<span>{formatCurrency(totalAmount)}</span>
											</div>
										</div>
									) : null;
								}}
							</form.Subscribe>
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
											m.common_save()
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
					<CardTitle>{m.purchase_invoices_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{invoices.isLoading ? (
						<DataLoading />
					) : invoices.isError ? (
						<DataError onRetry={() => void invoices.refetch()} />
					) : invoices.data?.data.length ? (
						<DataTable
							columns={supplierInvoiceColumns}
							data={invoices.data.data}
							getRowId={(row) => row.id}
						/>
					) : (
						<DataEmpty
							title={m.purchase_invoices_empty_title()}
							description={m.purchase_invoices_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
