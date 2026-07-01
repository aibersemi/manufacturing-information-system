import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye } from "lucide-react";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import { useBackendApiMasterdataListProductVariants } from "@/api/generated/master-data/master-data";
import type { ProductionOrderResponse } from "@/api/generated/models/productionOrderResponse";
import {
	useBackendApiProductionCreateProductionOrder,
	useBackendApiProductionListProductionOrders,
} from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { integerInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { productionOrdersRoute } from "./orders";

const productionOrderSchema = z.object({
	orderNumber: z.string().min(1, m.production_spk_required()),
	orderType: z.enum(["for_stock", "for_po"]),
	productVariantId: z.string().min(1, m.production_variant_required()),
	targetQuantity: z.string().refine((value) => integerInput(value) > 0, {
		message: m.production_quantity_required(),
	}),
});

const productionOrderColumns: ColumnDef<ProductionOrderResponse>[] = [
	{
		accessorKey: "order_number",
		header: m.production_spk_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.order_number}</span>,
	},
	{
		accessorKey: "product_variant_sku",
		header: m.products_variant(),
		cell: ({ row }) => row.original.product_variant_sku || row.original.product_variant_id,
	},
	{ accessorKey: "order_type", header: m.common_type() },
	{
		accessorKey: "target_quantity",
		header: m.production_target_quantity(),
		cell: ({ row }) => formatNumberId(row.original.target_quantity),
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
	{
		id: "actions",
		header: m.common_action(),
		cell: ({ row }) => (
			<Button type="button" variant="ghost" size="icon" asChild aria-label={m.common_detail()}>
				<Link to="/dashboard/production/orders/$orderId" params={{ orderId: row.original.id }}>
					<Eye data-icon="icon" />
				</Link>
			</Button>
		),
	},
];

export function ProductionOrdersRouteScreen() {
	return (
		<AccessGuard anyOf={["production.orders.read"]}>
			<ProductionOrdersScreen />
		</AccessGuard>
	);
}

function ProductionOrdersScreen() {
	const search = useSearch({ from: productionOrdersRoute.id });
	const navigate = useNavigate({ from: productionOrdersRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canManage = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"production.orders.create",
	);
	const { data: response, isLoading, refetch } = useBackendApiProductionListProductionOrders();
	const orders = response?.data;
	const variants = useBackendApiMasterdataListProductVariants();
	const createMutation = useBackendApiProductionCreateProductionOrder();
	const isCreateOpen = canManage && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			orderNumber: "",
			orderType: "for_stock",
			productVariantId: "",
			targetQuantity: "10",
		},
		validators: {
			onChange: productionOrderSchema,
			onSubmit: productionOrderSchema,
		},
		onSubmit: async ({ value }) => {
			await createMutation.mutateAsync({
				data: {
					order_number: value.orderNumber,
					order_type: value.orderType,
					product_variant_id: value.productVariantId,
					target_quantity: integerInput(value.targetQuantity),
					status: "draft",
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
					<h1 className="text-2xl font-bold">{m.production_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.production_description()}</p>
				</div>
				{canManage ? (
					<Button type="button" onClick={openCreate}>
						{m.production_create_title()}
					</Button>
				) : null}
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle>{m.production_list_title()}</CardTitle>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<DataLoading />
						) : orders?.length ? (
							<DataTable
								columns={productionOrderColumns}
								data={orders}
								getRowId={(order) => order.id}
							/>
						) : (
							<DataEmpty
								title={m.production_empty_title()}
								description={m.production_empty_description()}
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
						title={m.production_create_title()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void form.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<form.Field name="orderNumber">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="production-order-number">
													{m.production_spk_number()}
												</FieldLabel>
												<Input
													id="production-order-number"
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
								<form.Field name="orderType">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="production-order-type">
													{m.production_order_type()}
												</FieldLabel>
												<NativeSelect
													id="production-order-type"
													name={field.name}
													className="w-full"
													value={field.state.value}
													onChange={(event) =>
														field.handleChange(event.target.value as "for_stock" | "for_po")
													}
													onBlur={field.handleBlur}
													aria-invalid={invalid}
												>
													<NativeSelectOption value="for_stock">
														{m.production_for_stock()}
													</NativeSelectOption>
													<NativeSelectOption value="for_po">
														{m.production_for_po()}
													</NativeSelectOption>
												</NativeSelect>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</Field>
										);
									}}
								</form.Field>
								<form.Field name="productVariantId">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="product-variant-id">{m.products_variant()}</FieldLabel>
												<NativeSelect
													id="product-variant-id"
													name={field.name}
													className="w-full"
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													aria-invalid={invalid}
													required
												>
													<NativeSelectOption value="">
														{m.products_select_variant()}
													</NativeSelectOption>
													{variants.data?.data.map((variant) => (
														<NativeSelectOption key={variant.id} value={variant.id}>
															{variant.sku} - {variant.color} {variant.size}
														</NativeSelectOption>
													))}
												</NativeSelect>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</Field>
										);
									}}
								</form.Field>
								<form.Field name="targetQuantity">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="production-target-quantity">
													{m.production_target_quantity()}
												</FieldLabel>
												<Input
													id="production-target-quantity"
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
