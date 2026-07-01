import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiInventoryCreatePurchaseOrder,
	useBackendApiInventoryListPurchaseOrders,
} from "@/api/generated/inventory/inventory";
import {
	useBackendApiMasterdataListMaterials,
	useBackendApiMasterdataListSuppliers,
} from "@/api/generated/master-data/master-data";
import type { PurchaseOrderResponse } from "@/api/generated/models/purchaseOrderResponse";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { decimalInput, integerInput } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { purchasesRoute } from "./purchases";

const purchaseSchema = z.object({
	supplierId: z.string().min(1, m.common_supplier_required()),
	materialId: z.string().min(1, m.common_material_required()),
	quantity: z.string().min(1, m.common_quantity_required()),
	unitPrice: z.string().min(1, m.common_unit_price_required()),
});

const purchaseColumns: ColumnDef<PurchaseOrderResponse>[] = [
	{
		accessorKey: "po_number",
		header: m.purchases_po_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.po_number || "-"}</span>,
	},
	{
		accessorKey: "supplier.name",
		header: m.common_supplier(),
		cell: ({ row }) => <span>{row.original.supplier_id}</span>,
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
	{
		accessorKey: "total_amount",
		header: m.common_total(),
		cell: ({ row }) => formatCurrency(row.original.total_amount || 0),
	},
];

export function PurchasesRouteScreen() {
	return (
		<AccessGuard anyOf={["inventory.purchases.read"]}>
			<PurchasesScreen />
		</AccessGuard>
	);
}

function PurchasesScreen() {
	const search = useSearch({ from: purchasesRoute.id });
	const navigate = useNavigate({ from: purchasesRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canManage = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"inventory.purchases.create",
	);

	const { data: response, isLoading, refetch } = useBackendApiInventoryListPurchaseOrders();
	const purchases = response?.data;

	const { data: suppliersResponse } = useBackendApiMasterdataListSuppliers();
	const suppliers = suppliersResponse?.data || [];

	const { data: materialsResponse } = useBackendApiMasterdataListMaterials();
	const materials = materialsResponse?.data || [];

	const createMutation = useBackendApiInventoryCreatePurchaseOrder();
	const isCreateOpen = canManage && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};

	const form = useForm({
		defaultValues: {
			supplierId: "",
			materialId: "",
			quantity: "10",
			unitPrice: "1000",
		},
		validators: {
			onChange: purchaseSchema,
			onSubmit: purchaseSchema,
		},
		onSubmit: async ({ value }) => {
			await createMutation.mutateAsync({
				data: {
					supplier_id: value.supplierId,
					lines: [
						{
							material_id: value.materialId,
							quantity: integerInput(value.quantity),
							unit_price: decimalInput(value.unitPrice),
						},
					],
				},
			});
			form.reset();
			await refetch();
			closeCreate();
		},
	});

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.purchases_orders_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.purchases_description()}</p>
				</div>
				{canManage ? (
					<Button type="button" onClick={openCreate}>
						{m.purchases_add_po()}
					</Button>
				) : null}
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle>{m.purchases_orders_list()}</CardTitle>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<DataLoading />
						) : purchases?.length ? (
							<DataTable columns={purchaseColumns} data={purchases} getRowId={(p) => p.id} />
						) : (
							<DataEmpty
								title={m.purchases_empty_title()}
								description={m.purchases_empty_description()}
							/>
						)}
					</CardContent>
				</Card>

				{canManage ? (
					<ActionSheet
						open={isCreateOpen}
						onOpenChange={(open) => {
							if (!open) closeCreate();
						}}
						title={m.purchases_add_po()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void form.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<form.Field name="supplierId">
									{(field) => {
										const _invalid = field.state.meta.errors.length > 0;
										return (
											<div className="flex flex-col gap-2">
												<FieldLabel htmlFor="supplier-id">{m.common_supplier()}</FieldLabel>
												<Select value={field.state.value} onValueChange={field.handleChange}>
													<SelectTrigger id="supplier-id">
														<SelectValue placeholder={m.common_select_supplier()} />
													</SelectTrigger>
													<SelectContent>
														{suppliers.map((s) => (
															<SelectItem key={s.id} value={s.id}>
																{s.name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</div>
										);
									}}
								</form.Field>

								<div className="rounded-md border p-4 flex flex-col gap-4">
									<p className="text-sm font-semibold">{m.purchases_first_item()}</p>
									<form.Field name="materialId">
										{(field) => {
											const _invalid = field.state.meta.errors.length > 0;
											return (
												<div className="flex flex-col gap-2">
													<FieldLabel htmlFor="material-id">{m.common_material()}</FieldLabel>
													<Select value={field.state.value} onValueChange={field.handleChange}>
														<SelectTrigger id="material-id">
															<SelectValue placeholder={m.common_select_material()} />
														</SelectTrigger>
														<SelectContent>
															{materials.map((m) => (
																<SelectItem key={m.id} value={m.id}>
																	{m.name}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</div>
											);
										}}
									</form.Field>
									<form.Field name="quantity">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="qty">{m.common_quantity()}</FieldLabel>
													<Input
														id="qty"
														name={field.name}
														type="text"
														inputMode="numeric"
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
									<form.Field name="unitPrice">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="price">{m.common_unit_price()}</FieldLabel>
													<Input
														id="price"
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
								</div>

								<form.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<Button type="submit" disabled={isSubmitting || createMutation.isPending}>
											{createMutation.isPending ? (
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
			</div>
		</div>
	);
}
