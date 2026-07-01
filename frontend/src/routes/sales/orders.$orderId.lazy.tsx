import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Plus } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import { useBackendApiMasterdataListProductVariants } from "@/api/generated/master-data/master-data";
import type { SalesPOLineResponse } from "@/api/generated/models/salesPOLineResponse";
import {
	getBackendApiSalesListSalesOrderLinesQueryKey,
	useBackendApiSalesCreateSalesOrderLine,
	useBackendApiSalesListSalesOrderLines,
	useBackendApiSalesListSalesOrders,
} from "@/api/generated/sales/sales";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { can } from "@/lib/capabilities";
import { decimalInput, integerInput } from "@/lib/form-values";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import * as m from "@/paraglide/messages";
import { salesOrderDetailRoute } from "./orders.$orderId";

export function SalesOrderDetailRouteScreen() {
	return (
		<AccessGuard anyOf={["sales.orders.read"]}>
			<SalesOrderDetailScreen />
		</AccessGuard>
	);
}

const orderDialogStore = new Store({ open: false });

function SalesOrderDetailScreen() {
	const { orderId } = useParams({ from: salesOrderDetailRoute.id });
	const queryClient = useQueryClient();
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canAddLine = can(capabilityList, "sales.orders.create");

	const isAddLineOpen = useStore(orderDialogStore, (state) => state.open);

	const { data: ordersResponse, isLoading: isLoadingOrders } = useBackendApiSalesListSalesOrders();
	const order = ordersResponse?.data?.find((o) => o.id === orderId);

	const { data: linesResponse, isLoading: isLoadingLines } =
		useBackendApiSalesListSalesOrderLines(orderId);
	const lines = linesResponse?.data || [];

	const { data: variantsResponse } = useBackendApiMasterdataListProductVariants();
	const variants = variantsResponse?.data || [];

	const lineColumns = useMemo<ColumnDef<SalesPOLineResponse>[]>(
		() => [
			{
				accessorKey: "product_variant_id",
				header: () => m.products_variant(),
				cell: ({ row }) => {
					const variant = variants.find((v) => v.id === row.original.product_variant_id);
					return (
						<span className="font-medium">
							{variant
								? `${variant.sku} - ${variant.color} ${variant.size}`
								: row.original.product_variant_id}
						</span>
					);
				},
			},
			{
				accessorKey: "quantity",
				header: () => m.common_quantity(),
				cell: ({ row }) => formatNumberId(row.original.quantity),
			},
			{
				accessorKey: "unit_price",
				header: () => m.common_unit_price(),
				cell: ({ row }) => formatCurrency(row.original.unit_price),
			},
			{
				accessorKey: "fulfilled_qty",
				header: () => m.sales_order_fulfilled_quantity(),
				cell: ({ row }) => formatNumberId(row.original.fulfilled_qty),
			},
		],
		[variants],
	);

	const { mutateAsync: createSalesOrderLine } = useBackendApiSalesCreateSalesOrderLine();

	const form = useForm({
		defaultValues: {
			productVariantId: "",
			quantity: "",
			unitPrice: "",
		},
		onSubmit: async ({ value }) => {
			try {
				await createSalesOrderLine({
					data: {
						sales_po_id: orderId,
						product_variant_id: value.productVariantId,
						quantity: integerInput(value.quantity),
						unit_price: decimalInput(value.unitPrice),
					},
				});
				toast.success(m.sales_order_line_added_success());
				queryClient.invalidateQueries({
					queryKey: getBackendApiSalesListSalesOrderLinesQueryKey(orderId),
				});
				orderDialogStore.setState((_s) => ({ open: false }));
				form.reset();
			} catch (_error) {
				toast.error(m.common_mutation_error());
			}
		},
	});

	if (isLoadingOrders) return <DataLoading />;
	if (!order)
		return (
			<DataEmpty
				title={m.sales_order_not_found_title()}
				description={m.sales_order_not_found_description()}
			/>
		);

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex items-center gap-4">
				<Button variant="outline" size="icon" asChild>
					<Link to="/dashboard/sales/orders">
						<ArrowLeft className="h-4 w-4" />
					</Link>
				</Button>
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">
						{m.sales_orders_detail_prefix()}
						{order.po_number}
					</h1>
					<p className="text-sm text-muted-foreground">
						{m.sales_order_summary({ status: order.status, date: order.order_date })}
					</p>
				</div>
			</div>

			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
					<CardTitle>{m.sales_orders_item()}</CardTitle>
					{canAddLine ? (
						<Sheet
							open={isAddLineOpen}
							onOpenChange={(v) => orderDialogStore.setState((_s) => ({ open: v }))}
						>
							<SheetTrigger asChild>
								<Button size="sm">
									<Plus className="mr-2 h-4 w-4" />
									{m.sales_orders_add_item()}
								</Button>
							</SheetTrigger>
							<SheetContent>
								<SheetHeader>
									<SheetTitle>{m.sales_orders_add_item()}</SheetTitle>
									<SheetDescription>{m.sales_orders_enter_product_detail()}</SheetDescription>
								</SheetHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										form.handleSubmit();
									}}
									className="mt-6 flex flex-col gap-4"
								>
									<form.Field
										name="productVariantId"
										validators={{
											onChange: ({ value }) => (!value ? m.products_variant_required() : undefined),
										}}
										children={(field) => (
											<div className="flex flex-col gap-2">
												<Label htmlFor={field.name}>{m.products_variant()}</Label>
												<Select value={field.state.value} onValueChange={field.handleChange}>
													<SelectTrigger id={field.name}>
														<SelectValue placeholder={m.products_select_variant()} />
													</SelectTrigger>
													<SelectContent>
														{variants.map((v) => (
															<SelectItem key={v.id} value={v.id}>
																{v.sku} - {v.color} {v.size}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
												{field.state.meta.errors ? (
													<p className="text-sm text-destructive">
														{field.state.meta.errors.join(", ")}
													</p>
												) : null}
											</div>
										)}
									/>
									<form.Field
										name="quantity"
										validators={{
											onChange: ({ value }) => (!value ? m.common_quantity_required() : undefined),
										}}
										children={(field) => (
											<div className="flex flex-col gap-2">
												<Label htmlFor={field.name}>{m.common_quantity()}</Label>
												<Input
													id={field.name}
													type="text"
													inputMode="numeric"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													required
												/>
											</div>
										)}
									/>
									<form.Field
										name="unitPrice"
										validators={{
											onChange: ({ value }) =>
												!value ? m.common_unit_price_required() : undefined,
										}}
										children={(field) => (
											<div className="flex flex-col gap-2">
												<Label htmlFor={field.name}>{m.common_unit_price()}</Label>
												<Input
													id={field.name}
													type="text"
													inputMode="decimal"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													required
												/>
											</div>
										)}
									/>
									<form.Subscribe
										selector={(state) => [state.canSubmit, state.isSubmitting]}
										children={([canSubmit, isSubmitting]) => (
											<Button type="submit" disabled={!canSubmit || isSubmitting} className="mt-4">
												{isSubmitting ? m.common_saving() : m.common_save_item()}
											</Button>
										)}
									/>
								</form>
							</SheetContent>
						</Sheet>
					) : null}
				</CardHeader>
				<CardContent>
					{isLoadingLines ? (
						<DataLoading />
					) : lines.length ? (
						<DataTable
							columns={lineColumns}
							data={lines}
							getRowId={(l) => l.id || Math.random().toString()}
						/>
					) : (
						<DataEmpty
							title={m.sales_order_lines_empty_title()}
							description={m.sales_order_lines_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
