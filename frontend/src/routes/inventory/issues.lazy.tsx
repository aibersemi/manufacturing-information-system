import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiInventoryCreateMaterialMovement,
	useBackendApiInventoryListMaterialLedger,
} from "@/api/generated/inventory/inventory";
import { useBackendApiMasterdataListMaterials } from "@/api/generated/master-data/master-data";
import type { MaterialLedgerResponse } from "@/api/generated/models";
import {
	useBackendApiProductionIssueMaterials,
	useBackendApiProductionListProductionOrders,
} from "@/api/generated/production/production";
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
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities";
import {
	decimalInput,
	newIdempotencyKey,
	optionalDecimalInput,
	trimmedOptional,
} from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { materialIssuesRoute } from "./issues";

const materialIssueSchema = z.object({
	materialId: z.string().trim().min(1, m.common_material_required()),
	quantity: z
		.string()
		.trim()
		.min(1, m.common_quantity_required())
		.refine((value) => decimalInput(value) > 0, { message: m.material_issues_quantity_positive() }),
	unitCost: z.string().trim(),
	referenceDocument: z.string().trim().min(1, m.material_issues_reference_required()),
	productionOrderId: z.string().trim(),
	reason: z.string().trim(),
	notes: z.string().trim(),
});

const productionIssueSchema = z.object({
	orderId: z.string().trim().min(1, m.material_issues_order_required()),
});

export function MaterialIssuesRouteScreen() {
	return (
		<AccessGuard
			anyOf={[
				"inventory.material_ledger.read",
				"inventory.material_ledger.create",
				"production.orders.issue_materials",
			]}
		>
			<MaterialIssuesScreen />
		</AccessGuard>
	);
}

function MaterialIssuesScreen() {
	const search = useSearch({ from: materialIssuesRoute.id });
	const navigate = useNavigate({ from: materialIssuesRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreateMovement = can(capabilityList, "inventory.material_ledger.create");
	const canIssueProduction = can(capabilityList, "production.orders.issue_materials");
	const ledger = useBackendApiInventoryListMaterialLedger();
	const materials = useBackendApiMasterdataListMaterials();
	const productionOrders = useBackendApiProductionListProductionOrders();
	const movementMutation = useBackendApiInventoryCreateMaterialMovement();
	const productionIssueMutation = useBackendApiProductionIssueMaterials();
	const issueRows = ledger.data?.data.filter((item) => item.transaction_type === "issue") ?? [];
	const materialNameById = useMemo(
		() => new Map(materials.data?.data.map((material) => [material.id, material.name]) ?? []),
		[materials.data?.data],
	);
	const issueColumns = useMemo<ColumnDef<MaterialLedgerResponse>[]>(
		() => [
			{
				accessorKey: "transaction_type",
				header: m.stock_transaction_type(),
				cell: ({ row }) => <Badge variant="secondary">{row.original.transaction_type}</Badge>,
			},
			{
				accessorKey: "material_id",
				header: m.materials_name(),
				cell: ({ row }) =>
					materialNameById.get(row.original.material_id) ?? row.original.material_id,
			},
			{
				accessorKey: "quantity",
				header: m.common_quantity(),
				cell: ({ row }) => formatNumberId(row.original.quantity, { maximumFractionDigits: 4 }),
			},
			{ accessorKey: "reference_document", header: m.common_reference() },
			{
				accessorKey: "notes",
				header: m.common_notes(),
				cell: ({ row }) => row.original.notes || "—",
			},
		],
		[materialNameById],
	);
	const isCreateOpen = canCreateMovement && search.action === "create";
	const isProductionOpen = canIssueProduction && search.action === "production";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const openProduction = () => {
		navigate({ search: (previous) => ({ ...previous, action: "production" }) });
	};
	const closeSheet = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const movementForm = useForm({
		defaultValues: {
			materialId: "",
			quantity: "",
			unitCost: "",
			referenceDocument: "",
			productionOrderId: "",
			reason: "",
			notes: "",
		},
		validators: {
			onChange: materialIssueSchema,
			onSubmit: materialIssueSchema,
		},
		onSubmit: async ({ value }) => {
			await movementMutation.mutateAsync({
				data: {
					material_id: value.materialId,
					transaction_type: "issue",
					quantity: decimalInput(value.quantity),
					unit_cost: optionalDecimalInput(value.unitCost),
					reference_document: value.referenceDocument,
					idempotency_key: newIdempotencyKey("material-issue"),
					production_order_id: trimmedOptional(value.productionOrderId),
					reason: value.reason,
					notes: value.notes,
				},
			});
			movementForm.reset();
			await queryClient.invalidateQueries({ queryKey: ledger.queryKey });
			closeSheet();
		},
	});
	const productionIssueForm = useForm({
		defaultValues: {
			orderId: "",
		},
		validators: {
			onChange: productionIssueSchema,
			onSubmit: productionIssueSchema,
		},
		onSubmit: async ({ value }) => {
			await productionIssueMutation.mutateAsync({ orderId: value.orderId });
			productionIssueForm.reset();
			await queryClient.invalidateQueries({ queryKey: ledger.queryKey });
			closeSheet();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_material_issues()}</h1>
					<p className="text-sm text-muted-foreground">{m.material_issues_description()}</p>
				</div>
				{canCreateMovement || canIssueProduction ? (
					<div className="flex flex-col gap-2 sm:flex-row">
						{canCreateMovement ? (
							<Button type="button" onClick={openCreate}>
								{m.material_issues_create_title()}
							</Button>
						) : null}
						{canIssueProduction ? (
							<Button type="button" variant="outline" onClick={openProduction}>
								{m.material_issues_production_title()}
							</Button>
						) : null}
					</div>
				) : null}
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle>{m.material_issues_list_title()}</CardTitle>
					</CardHeader>
					<CardContent>
						{ledger.isLoading ? (
							<DataLoading />
						) : ledger.isError ? (
							<DataError onRetry={() => void ledger.refetch()} />
						) : issueRows.length ? (
							<DataTable columns={issueColumns} data={issueRows} getRowId={(row) => row.id} />
						) : (
							<DataEmpty
								title={m.material_issues_empty_title()}
								description={m.material_issues_empty_description()}
							/>
						)}
					</CardContent>
				</Card>

				{canCreateMovement ? (
					<ActionSheet
						open={isCreateOpen}
						onOpenChange={(open) => {
							if (!open) closeSheet();
						}}
						title={m.material_issues_create_title()}
						description={m.material_issues_create_description()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void movementForm.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<movementForm.Field name="materialId">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="issue-material">{m.common_material()}</FieldLabel>
												<NativeSelect
													id="issue-material"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													className="w-full"
													aria-invalid={invalid}
													required
												>
													<NativeSelectOption value="">
														{m.common_select_material()}
													</NativeSelectOption>
													{materials.data?.data.map((material) => (
														<NativeSelectOption key={material.id} value={material.id}>
															{material.name}
														</NativeSelectOption>
													))}
												</NativeSelect>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</Field>
										);
									}}
								</movementForm.Field>
								<movementForm.Field name="quantity">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="issue-quantity">{m.common_quantity()}</FieldLabel>
												<Input
													id="issue-quantity"
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
								</movementForm.Field>
								<movementForm.Field name="unitCost">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="issue-unit-cost">{m.common_unit_price()}</FieldLabel>
											<Input
												id="issue-unit-cost"
												name={field.name}
												type="text"
												inputMode="decimal"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</Field>
									)}
								</movementForm.Field>
								<movementForm.Field name="referenceDocument">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="issue-reference">{m.common_reference()}</FieldLabel>
												<Input
													id="issue-reference"
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
								</movementForm.Field>
								<movementForm.Field name="productionOrderId">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="issue-production-order">
												{m.material_issues_production_order()}
											</FieldLabel>
											<NativeSelect
												id="issue-production-order"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
											>
												<NativeSelectOption value="">
													{m.material_issues_select_order()}
												</NativeSelectOption>
												{productionOrders.data?.data.map((order) => (
													<NativeSelectOption key={order.id} value={order.id}>
														{order.order_number}
													</NativeSelectOption>
												))}
											</NativeSelect>
										</Field>
									)}
								</movementForm.Field>
								<movementForm.Field name="reason">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="issue-reason">{m.common_reason()}</FieldLabel>
											<Input
												id="issue-reason"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</Field>
									)}
								</movementForm.Field>
								<movementForm.Field name="notes">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="issue-notes">{m.common_notes()}</FieldLabel>
											<Textarea
												id="issue-notes"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</Field>
									)}
								</movementForm.Field>
								<movementForm.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<Button type="submit" disabled={isSubmitting || movementMutation.isPending}>
											{movementMutation.isPending ? (
												<>
													<Spinner data-icon="inline-start" />
													{m.common_saving()}
												</>
											) : (
												m.material_issues_submit()
											)}
										</Button>
									)}
								</movementForm.Subscribe>
							</FieldGroup>
						</form>
					</ActionSheet>
				) : null}

				{canIssueProduction ? (
					<ActionSheet
						open={isProductionOpen}
						onOpenChange={(open) => {
							if (!open) closeSheet();
						}}
						title={m.material_issues_production_title()}
						description={m.material_issues_production_description()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void productionIssueForm.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<productionIssueForm.Field name="orderId">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="production-issue-order">
													{m.material_issues_production_order()}
												</FieldLabel>
												<NativeSelect
													id="production-issue-order"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													className="w-full"
													aria-invalid={invalid}
													required
												>
													<NativeSelectOption value="">
														{m.material_issues_select_order()}
													</NativeSelectOption>
													{productionOrders.data?.data.map((order) => (
														<NativeSelectOption key={order.id} value={order.id}>
															{order.order_number}
														</NativeSelectOption>
													))}
												</NativeSelect>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</Field>
										);
									}}
								</productionIssueForm.Field>
								<productionIssueForm.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<Button
											type="submit"
											variant="outline"
											disabled={isSubmitting || productionIssueMutation.isPending}
										>
											{productionIssueMutation.isPending ? (
												<>
													<Spinner data-icon="inline-start" />
													{m.common_saving()}
												</>
											) : (
												m.material_issues_issue_order()
											)}
										</Button>
									)}
								</productionIssueForm.Subscribe>
							</FieldGroup>
						</form>
					</ActionSheet>
				) : null}
			</div>
		</main>
	);
}
