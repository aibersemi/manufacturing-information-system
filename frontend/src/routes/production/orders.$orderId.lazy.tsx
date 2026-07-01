import { useForm } from "@tanstack/react-form";
import { Link, useParams } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	ArrowLeft,
	CheckCircle2,
	PackageCheck,
	RefreshCw,
	SendToBack,
	ShoppingCart,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import type { MaterialRequirementResponse } from "@/api/generated/models";
import {
	useBackendApiProductionCompleteOrder,
	useBackendApiProductionGeneratePrs,
	useBackendApiProductionGetProductionOrder,
	useBackendApiProductionIssueMaterials,
	useBackendApiProductionRecalculateMrp,
	useBackendApiProductionReleaseOrder,
	useBackendApiProductionReserveMaterials,
} from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { integerInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { productionOrderDetailRoute } from "./orders.$orderId";

const completeSchema = z.object({
	outputQuantity: z
		.string()
		.trim()
		.refine((value) => integerInput(value) > 0, {
			message: m.production_output_quantity_required(),
		}),
	lotNumber: z.string().trim().min(1, m.production_lot_required()),
});

function quantity(value: string | number) {
	return formatNumberId(value, {
		maximumFractionDigits: 4,
	});
}

export function ProductionOrderDetailRouteScreen() {
	return (
		<AccessGuard anyOf={["production.orders.read"]}>
			<ProductionOrderDetailScreen />
		</AccessGuard>
	);
}

function ProductionOrderDetailScreen() {
	const { orderId } = useParams({ from: productionOrderDetailRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const orderQuery = useBackendApiProductionGetProductionOrder(orderId);
	const releaseMutation = useBackendApiProductionReleaseOrder();
	const recalculateMutation = useBackendApiProductionRecalculateMrp();
	const reserveMutation = useBackendApiProductionReserveMaterials();
	const generatePrMutation = useBackendApiProductionGeneratePrs();
	const issueMutation = useBackendApiProductionIssueMaterials();
	const completeMutation = useBackendApiProductionCompleteOrder();

	const canRelease = can(capabilityList, "production.orders.release");
	const canRecalculate = can(capabilityList, "production.orders.recalculate_mrp");
	const canReserve = can(capabilityList, "production.orders.reserve_materials");
	const canGeneratePr = can(capabilityList, "production.orders.generate_purchase_requests");
	const canIssue = can(capabilityList, "production.orders.issue_materials");
	const canComplete = can(capabilityList, "production.orders.complete");

	const requirements = orderQuery.data?.data.material_requirements ?? [];
	const requirementColumns = useMemo<ColumnDef<MaterialRequirementResponse>[]>(
		() => [
			{
				accessorKey: "material_name",
				header: () => m.materials_name(),
				cell: ({ row }) => <span className="font-medium">{row.original.material_name}</span>,
			},
			{
				accessorKey: "quantity_per_unit",
				header: () => m.production_mrp_per_piece(),
				cell: ({ row }) =>
					`${quantity(row.original.quantity_per_unit)} ${row.original.usage_uom_code}`,
			},
			{
				accessorKey: "required_usage_qty",
				header: () => m.production_mrp_required(),
				cell: ({ row }) =>
					`${quantity(row.original.required_usage_qty)} ${row.original.usage_uom_code}`,
			},
			{
				accessorKey: "available_usage_qty",
				header: () => m.production_mrp_available(),
				cell: ({ row }) =>
					`${quantity(row.original.available_usage_qty)} ${row.original.usage_uom_code}`,
			},
			{
				accessorKey: "reserved_usage_qty",
				header: () => m.production_mrp_reserved(),
				cell: ({ row }) =>
					`${quantity(row.original.reserved_usage_qty)} ${row.original.usage_uom_code}`,
			},
			{
				accessorKey: "ordered_purchase_qty",
				header: () => m.production_mrp_ordered(),
				cell: ({ row }) =>
					`${quantity(row.original.ordered_purchase_qty)} ${row.original.purchase_uom_code}`,
			},
			{
				accessorKey: "shortage_usage_qty",
				header: () => m.production_mrp_shortage(),
				cell: ({ row }) => (
					<Badge
						variant={Number(row.original.shortage_usage_qty) > 0 ? "destructive" : "secondary"}
					>
						{quantity(row.original.shortage_usage_qty)} {row.original.usage_uom_code}
					</Badge>
				),
			},
			{
				accessorKey: "recommended_purchase_qty",
				header: () => m.production_mrp_recommended_purchase(),
				cell: ({ row }) =>
					`${quantity(row.original.recommended_purchase_qty)} ${row.original.purchase_uom_code}`,
			},
			{
				accessorKey: "packaging_excess_usage_qty",
				header: () => m.production_mrp_packaging_excess(),
				cell: ({ row }) =>
					`${quantity(row.original.packaging_excess_usage_qty)} ${row.original.usage_uom_code}`,
			},
		],
		[],
	);

	const completeForm = useForm({
		defaultValues: {
			outputQuantity: orderQuery.data?.data.target_quantity
				? String(orderQuery.data.data.target_quantity)
				: "",
			lotNumber: "",
		},
		validators: {
			onChange: completeSchema,
			onSubmit: completeSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				await completeMutation.mutateAsync({
					orderId,
					data: {
						output_quantity: integerInput(value.outputQuantity),
						lot_number: value.lotNumber,
					},
				});
				toast.success(m.common_mutation_success());
				await orderQuery.refetch();
			} catch (_error) {
				toast.error(m.common_mutation_error());
			}
		},
	});

	const runAction = async (action: () => Promise<unknown>) => {
		try {
			await action();
			toast.success(m.common_mutation_success());
			await orderQuery.refetch();
		} catch (_error) {
			toast.error(m.common_mutation_error());
		}
	};

	if (orderQuery.isLoading) return <DataLoading />;
	if (orderQuery.isError) return <DataError onRetry={() => void orderQuery.refetch()} />;

	const order = orderQuery.data?.data;
	if (!order) {
		return (
			<DataEmpty
				title={m.production_order_not_found_title()}
				description={m.production_order_not_found_description()}
			/>
		);
	}

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex items-start gap-3">
					<Button variant="outline" size="icon" asChild aria-label={m.common_back()}>
						<Link to="/dashboard/production/orders">
							<ArrowLeft data-icon="icon" />
						</Link>
					</Button>
					<div className="flex flex-col gap-1">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="text-2xl font-bold">{order.order_number}</h1>
							<Badge variant="secondary">{order.status}</Badge>
						</div>
						<p className="text-sm text-muted-foreground">
							{m.production_order_detail_description()}
						</p>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{canRelease ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => runAction(() => releaseMutation.mutateAsync({ orderId }))}
							disabled={releaseMutation.isPending}
						>
							{releaseMutation.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<PackageCheck data-icon="inline-start" />
							)}
							{m.production_release_order()}
						</Button>
					) : null}
					{canRecalculate ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => runAction(() => recalculateMutation.mutateAsync({ orderId }))}
							disabled={recalculateMutation.isPending}
						>
							{recalculateMutation.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<RefreshCw data-icon="inline-start" />
							)}
							{m.production_recalculate_mrp()}
						</Button>
					) : null}
					{canReserve ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => runAction(() => reserveMutation.mutateAsync({ orderId }))}
							disabled={reserveMutation.isPending}
						>
							{reserveMutation.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<CheckCircle2 data-icon="inline-start" />
							)}
							{m.production_reserve_materials()}
						</Button>
					) : null}
					{canGeneratePr ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => runAction(() => generatePrMutation.mutateAsync({ orderId }))}
							disabled={generatePrMutation.isPending}
						>
							{generatePrMutation.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<ShoppingCart data-icon="inline-start" />
							)}
							{m.production_generate_pr()}
						</Button>
					) : null}
					{canIssue ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => runAction(() => issueMutation.mutateAsync({ orderId }))}
							disabled={issueMutation.isPending}
						>
							{issueMutation.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<SendToBack data-icon="inline-start" />
							)}
							{m.production_issue_materials()}
						</Button>
					) : null}
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				<Card>
					<CardHeader>
						<CardDescription>{m.products_variant()}</CardDescription>
						<CardTitle>{order.product_variant_sku || order.product_variant_id}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>{m.production_target_quantity()}</CardDescription>
						<CardTitle>{quantity(order.target_quantity)}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>{m.common_type()}</CardDescription>
						<CardTitle>{order.order_type}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>{m.common_due_date()}</CardDescription>
						<CardTitle>{order.target_completion_date || "-"}</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.production_mrp_title()}</CardTitle>
					<CardDescription>{m.production_order_detail_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					{requirements.length ? (
						<DataTable
							columns={requirementColumns}
							data={requirements}
							getRowId={(row) => row.id}
						/>
					) : (
						<DataEmpty
							title={m.production_mrp_title()}
							description={m.production_order_detail_description()}
						/>
					)}
				</CardContent>
			</Card>

			{canComplete ? (
				<Card>
					<CardHeader>
						<CardTitle>{m.production_complete_order()}</CardTitle>
						<CardDescription>{m.production_order_detail_description()}</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void completeForm.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
								<completeForm.Field name="outputQuantity">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="production-output-quantity">
													{m.common_quantity()}
												</FieldLabel>
												<Input
													id="production-output-quantity"
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
								</completeForm.Field>
								<completeForm.Field name="lotNumber">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="production-lot-number">
													{m.production_lot_number()}
												</FieldLabel>
												<Input
													id="production-lot-number"
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
								</completeForm.Field>
								<completeForm.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<Button type="submit" disabled={isSubmitting || completeMutation.isPending}>
											{completeMutation.isPending ? (
												<Spinner data-icon="inline-start" />
											) : (
												<CheckCircle2 data-icon="inline-start" />
											)}
											{m.production_complete_order()}
										</Button>
									)}
								</completeForm.Subscribe>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>
			) : null}
		</main>
	);
}
