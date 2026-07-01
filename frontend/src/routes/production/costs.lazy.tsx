import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import type { ProductionCostResponse } from "@/api/generated/models";
import {
	useBackendApiProductionCreateProductionCost,
	useBackendApiProductionListProductionCosts,
	useBackendApiProductionListProductionOrders,
} from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { decimalInput } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { productionCostsRoute } from "./costs";

const costSchema = z.object({
	productionOrderId: z.string().trim().min(1, m.production_costs_order_required()),
	component: z.string().trim().min(1, m.production_costs_component_required()),
	sourceType: z.string().trim().min(1, m.production_costs_source_type()),
	sourceId: z.string().trim(),
	amount: z
		.string()
		.trim()
		.refine((value) => decimalInput(value) > 0, {
			message: m.production_costs_amount_required(),
		}),
	allocationBasis: z.string().trim().min(1, m.production_costs_allocation_basis()),
});

const columns: ColumnDef<ProductionCostResponse>[] = [
	{ accessorKey: "order_number", header: m.production_spk_number() },
	{ accessorKey: "component", header: m.production_costs_component() },
	{ accessorKey: "source_type", header: m.production_costs_source_type() },
	{
		accessorKey: "amount",
		header: m.common_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount),
	},
	{ accessorKey: "allocation_basis", header: m.production_costs_allocation_basis() },
];

export function ProductionCostsRouteScreen() {
	return (
		<AccessGuard anyOf={["production.costs.read", "production.hpp.estimate"]}>
			<ProductionCostsScreen />
		</AccessGuard>
	);
}

function ProductionCostsScreen() {
	const search = useSearch({ from: productionCostsRoute.id });
	const navigate = useNavigate({ from: productionCostsRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "production.costs.create");
	const costs = useBackendApiProductionListProductionCosts();
	const orders = useBackendApiProductionListProductionOrders();
	const mutation = useBackendApiProductionCreateProductionCost();
	const isCreateOpen = canCreate && search.action === "create";
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			productionOrderId: "",
			component: "",
			sourceType: "manual",
			sourceId: "",
			amount: "",
			allocationBasis: "manual",
		},
		validators: {
			onChange: costSchema,
			onSubmit: costSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					production_order_id: value.productionOrderId,
					component: value.component,
					source_type: value.sourceType,
					source_id: value.sourceId,
					amount: decimalInput(value.amount),
					allocation_basis: value.allocationBasis,
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: costs.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_production_costs()}</h1>
					<p className="text-sm text-muted-foreground">{m.production_costs_description()}</p>
				</div>
				{canCreate ? (
					<Button
						type="button"
						onClick={() => navigate({ search: (previous) => ({ ...previous, action: "create" }) })}
					>
						<Plus data-icon="inline-start" />
						{m.production_costs_add()}
					</Button>
				) : null}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.production_costs_list()}</CardTitle>
				</CardHeader>
				<CardContent>
					{costs.isLoading ? (
						<DataLoading />
					) : costs.isError ? (
						<DataError onRetry={() => void costs.refetch()} />
					) : costs.data?.data.length ? (
						<DataTable columns={columns} data={costs.data.data} getRowId={(row) => row.id} />
					) : (
						<DataEmpty
							title={m.production_costs_list()}
							description={m.production_costs_description()}
						/>
					)}
				</CardContent>
			</Card>

			{canCreate ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.production_costs_add()}
					description={m.production_costs_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="productionOrderId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="production-cost-order">
												{m.production_spk_number()}
											</FieldLabel>
											<NativeSelect
												id="production-cost-order"
												name={field.name}
												className="w-full"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.production_spk_number()}
												</NativeSelectOption>
												{orders.data?.data.map((order) => (
													<NativeSelectOption key={order.id} value={order.id}>
														{order.order_number} -{" "}
														{order.product_variant_sku || order.product_variant_id}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="component">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="production-cost-component">
												{m.production_costs_component()}
											</FieldLabel>
											<Input
												id="production-cost-component"
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
											<FieldLabel htmlFor="production-cost-amount">{m.common_amount()}</FieldLabel>
											<Input
												id="production-cost-amount"
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
							<form.Field name="sourceType">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="production-cost-source-type">
											{m.production_costs_source_type()}
										</FieldLabel>
										<Input
											id="production-cost-source-type"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</Field>
								)}
							</form.Field>
							<form.Field name="sourceId">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="production-cost-source-id">
											{m.production_costs_source_id()}
										</FieldLabel>
										<Input
											id="production-cost-source-id"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</Field>
								)}
							</form.Field>
							<form.Field name="allocationBasis">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="production-cost-basis">
											{m.production_costs_allocation_basis()}
										</FieldLabel>
										<Input
											id="production-cost-basis"
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
									<Button type="submit" disabled={isSubmitting || mutation.isPending}>
										{mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
										{m.common_save()}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</ActionSheet>
			) : null}
		</main>
	);
}
