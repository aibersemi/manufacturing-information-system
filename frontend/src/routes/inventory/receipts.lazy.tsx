import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiInventoryListPurchaseOrders,
	useBackendApiInventoryReceiveMaterial,
} from "@/api/generated/inventory/inventory";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { Button } from "@/components/ui/button";
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
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { materialReceiptsRoute } from "./receipts";

const receiptSchema = z.object({
	purchaseOrderId: z.string().min(1, m.receipts_purchase_order_required()),
	receiptDate: z.string().min(1, m.receipts_date_required()),
	supplierDoNumber: z.string(),
	purchaseOrderLineId: z.string().min(1, m.receipts_po_line_required()),
	receivedQty: z.string().min(1, m.common_quantity_required()),
	unitCost: z.string().min(1, m.receipts_unit_cost_required()),
});

export function MaterialReceiptsRouteScreen() {
	return (
		<AccessGuard anyOf={["inventory.receipts.create"]}>
			<MaterialReceiptsScreen />
		</AccessGuard>
	);
}

function MaterialReceiptsScreen() {
	const search = useSearch({ from: materialReceiptsRoute.id });
	const navigate = useNavigate({ from: materialReceiptsRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canManage = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"inventory.receipts.create",
	);

	const { data: posResponse } = useBackendApiInventoryListPurchaseOrders();
	const purchaseOrders = posResponse?.data || [];

	const createMutation = useBackendApiInventoryReceiveMaterial();

	const defaultDate = new Date().toISOString().split("T")[0];
	const isCreateOpen = canManage && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};

	const form = useForm({
		defaultValues: {
			purchaseOrderId: "",
			receiptDate: defaultDate,
			supplierDoNumber: "",
			purchaseOrderLineId: "",
			receivedQty: "",
			unitCost: "",
		},
		validators: {
			onChange: receiptSchema,
			onSubmit: receiptSchema,
		},
		onSubmit: async ({ value }) => {
			await createMutation.mutateAsync({
				data: {
					purchase_order_id: value.purchaseOrderId,
					receipt_date: value.receiptDate,
					supplier_do_number: value.supplierDoNumber,
					lines: [
						{
							purchase_order_line_id: value.purchaseOrderLineId,
							received_qty: integerInput(value.receivedQty),
							accepted_qty: integerInput(value.receivedQty),
							unit_cost: decimalInput(value.unitCost),
						},
					],
				},
			});
			form.reset();
			closeCreate();
		},
	});

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.nav_material_receipts()}</h1>
					<p className="text-sm text-muted-foreground">{m.material_receipts_description()}</p>
				</div>
				{canManage ? (
					<Button type="button" onClick={openCreate}>
						{m.receipts_add_new()}
					</Button>
				) : null}
			</div>

			{canManage ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.receipts_add_new()}
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
									const _invalid = field.state.meta.errors.length > 0;
									return (
										<div className="flex flex-col gap-2">
											<FieldLabel htmlFor="purchase-order-id">
												{m.receipts_purchase_order()}
											</FieldLabel>
											<Select value={field.state.value} onValueChange={field.handleChange}>
												<SelectTrigger id="purchase-order-id">
													<SelectValue placeholder={m.receipts_select_po()} />
												</SelectTrigger>
												<SelectContent>
													{purchaseOrders.map((po) => (
														<SelectItem key={po.id} value={String(po.id)}>
															{po.po_number}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</div>
									);
								}}
							</form.Field>

							<form.Field name="receiptDate">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="receipt-date">{m.receipts_date()}</FieldLabel>
											<Input
												id="receipt-date"
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

							<form.Field name="supplierDoNumber">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="supplier-do">
												{m.receipts_supplier_do_number()}
											</FieldLabel>
											<Input
												id="supplier-do"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>

							<div className="rounded-md border p-4 flex flex-col gap-4">
								<p className="text-sm font-semibold">{m.receipts_received_item()}</p>
								<form.Field name="purchaseOrderLineId">
									{(field) => {
										const _invalid = field.state.meta.errors.length > 0;
										return (
											<div className="flex flex-col gap-2">
												<FieldLabel htmlFor="po-line">{m.receipts_select_po_item()}</FieldLabel>
												<form.Subscribe selector={(state) => state.values.purchaseOrderId}>
													{(purchaseOrderId) => {
														const selectedPo = purchaseOrders.find(
															(po) => po.id === purchaseOrderId,
														);
														return (
															<Select
																value={field.state.value}
																onValueChange={field.handleChange}
																disabled={!selectedPo}
															>
																<SelectTrigger id="po-line">
																	<SelectValue placeholder={m.receipts_select_po_line()} />
																</SelectTrigger>
																<SelectContent>
																	{selectedPo?.lines?.map((line) => (
																		<SelectItem key={line.id} value={String(line.id)}>
																			{m.receipts_po_line_summary({
																				materialId: line.material_id,
																				quantity: line.quantity,
																			})}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														);
													}}
												</form.Subscribe>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</div>
										);
									}}
								</form.Field>
								<form.Field name="receivedQty">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="received-qty">
													{m.receipts_received_quantity()}
												</FieldLabel>
												<Input
													id="received-qty"
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
								<form.Field name="unitCost">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="unit-cost">{m.receipts_unit_cost()}</FieldLabel>
												<Input
													id="unit-cost"
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
	);
}
