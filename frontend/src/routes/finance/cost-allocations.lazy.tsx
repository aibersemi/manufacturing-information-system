import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { z } from "zod";
import { useBackendApiAccountingListAccountingPeriods } from "@/api/generated/accounting/accounting";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceCreateCostAllocation,
	useBackendApiFinanceListCostAllocations,
} from "@/api/generated/finance/finance";
import { useBackendApiMasterdataListCostCategories } from "@/api/generated/master-data/master-data";
import type { CostAllocationResponse } from "@/api/generated/models";
import { useBackendApiProductionListProductionOrders } from "@/api/generated/production/production";
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
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities";
import { decimalInput } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { costAllocationsRoute } from "./cost-allocations";

const allocationSchema = z.object({
	periodId: z.string().trim().min(1, m.cost_allocations_period_required()),
	categoryId: z.string().trim().min(1, m.cost_allocations_category_required()),
	productionOrderId: z.string().trim().min(1, m.production_costs_order_required()),
	amount: z
		.string()
		.trim()
		.refine((value) => decimalInput(value) > 0, {
			message: m.cost_allocations_amount_required(),
		}),
	allocationBasis: z.string().trim().min(1, m.production_costs_allocation_basis()),
	reason: z.string().trim().min(1, m.cost_allocations_reason_required()),
});

const columns: ColumnDef<CostAllocationResponse>[] = [
	{ accessorKey: "period_name", header: m.journals_period() },
	{ accessorKey: "category_name", header: m.common_category() },
	{
		accessorKey: "amount",
		header: m.common_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount),
	},
	{ accessorKey: "allocation_basis", header: m.production_costs_allocation_basis() },
	{
		accessorKey: "reason",
		header: m.common_reason(),
		cell: ({ row }) => row.original.reason || "-",
	},
];

export function CostAllocationsRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.cost_allocations.read", "reports.finance.read"]}>
			<CostAllocationsScreen />
		</AccessGuard>
	);
}

function CostAllocationsScreen() {
	const search = useSearch({ from: costAllocationsRoute.id });
	const navigate = useNavigate({ from: costAllocationsRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "finance.cost_allocations.create");
	const allocations = useBackendApiFinanceListCostAllocations();
	const periods = useBackendApiAccountingListAccountingPeriods();
	const categories = useBackendApiMasterdataListCostCategories();
	const orders = useBackendApiProductionListProductionOrders();
	const mutation = useBackendApiFinanceCreateCostAllocation();
	const isCreateOpen = canCreate && search.action === "create";
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			periodId: "",
			categoryId: "",
			productionOrderId: "",
			amount: "",
			allocationBasis: "manual",
			reason: "",
		},
		validators: {
			onChange: allocationSchema,
			onSubmit: allocationSchema,
		},
		onSubmit: async ({ value }) => {
			const amount = decimalInput(value.amount);
			await mutation.mutateAsync({
				data: {
					period_id: value.periodId,
					category_id: value.categoryId,
					amount,
					allocation_basis: value.allocationBasis,
					allocations: [
						{
							production_order_id: value.productionOrderId,
							amount,
						},
					],
					reason: value.reason,
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: allocations.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_cost_allocations()}</h1>
					<p className="text-sm text-muted-foreground">{m.cost_allocations_description()}</p>
				</div>
				{canCreate ? (
					<Button
						type="button"
						onClick={() => navigate({ search: (previous) => ({ ...previous, action: "create" }) })}
					>
						<Plus data-icon="inline-start" />
						{m.cost_allocations_add()}
					</Button>
				) : null}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.cost_allocations_list()}</CardTitle>
				</CardHeader>
				<CardContent>
					{allocations.isLoading ? (
						<DataLoading />
					) : allocations.isError ? (
						<DataError onRetry={() => void allocations.refetch()} />
					) : allocations.data?.data.length ? (
						<DataTable columns={columns} data={allocations.data.data} getRowId={(row) => row.id} />
					) : (
						<DataEmpty
							title={m.cost_allocations_list()}
							description={m.cost_allocations_description()}
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
					title={m.cost_allocations_add()}
					description={m.cost_allocations_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="periodId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="allocation-period">{m.journals_period()}</FieldLabel>
											<NativeSelect
												id="allocation-period"
												name={field.name}
												className="w-full"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.journals_select_period()}
												</NativeSelectOption>
												{periods.data?.data.map((period) => (
													<NativeSelectOption key={period.id} value={period.id}>
														{period.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="categoryId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="allocation-category">{m.common_category()}</FieldLabel>
											<NativeSelect
												id="allocation-category"
												name={field.name}
												className="w-full"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">{m.common_category()}</NativeSelectOption>
												{categories.data?.data.map((category) => (
													<NativeSelectOption key={category.id} value={category.id}>
														{category.code} - {category.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="productionOrderId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="allocation-order">
												{m.production_spk_number()}
											</FieldLabel>
											<NativeSelect
												id="allocation-order"
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
							<form.Field name="amount">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="allocation-amount">{m.common_amount()}</FieldLabel>
											<Input
												id="allocation-amount"
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
							<form.Field name="allocationBasis">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="allocation-basis">
											{m.production_costs_allocation_basis()}
										</FieldLabel>
										<Input
											id="allocation-basis"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</Field>
								)}
							</form.Field>
							<form.Field name="reason">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="allocation-reason">{m.common_reason()}</FieldLabel>
											<Textarea
												id="allocation-reason"
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
