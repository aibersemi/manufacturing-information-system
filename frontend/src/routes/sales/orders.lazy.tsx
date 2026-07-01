import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import { useBackendApiMasterdataListCustomers } from "@/api/generated/master-data/master-data";
import type { SalesPOResponse } from "@/api/generated/models/salesPOResponse";
import {
	useBackendApiSalesCreateSalesOrder,
	useBackendApiSalesDeleteSalesOrder,
	useBackendApiSalesListSalesOrders,
	useBackendApiSalesUpdateSalesOrder,
} from "@/api/generated/sales/sales";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { salesOrdersRoute } from "./orders";

const salesOrderSchema = z.object({
	customerId: z.string().min(1, m.sales_customer_required()),
	orderDate: z.string().min(1, m.sales_date_required()),
	dueDate: z.string(),
	notes: z.string(),
});

export function SalesOrdersRouteScreen() {
	return (
		<AccessGuard anyOf={["sales.orders.read"]}>
			<SalesOrdersScreen />
		</AccessGuard>
	);
}

function SalesOrdersScreen() {
	const search = useSearch({ from: salesOrdersRoute.id });
	const navigate = useNavigate({ from: salesOrdersRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as SalesPOResponse | null,
				deleteTarget: null as SalesPOResponse | null,
			}),
		[],
	);
	const ui = useStore(uiStore);
	const { selected, deleteTarget } = ui;
	const setUi = (patch: Partial<typeof ui>) =>
		uiStore.setState((state) => ({ ...state, ...patch }));

	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "sales.orders.create");
	const canUpdate = can(capabilityList, "sales.orders.update");
	const canDelete = can(capabilityList, "sales.orders.delete");
	const { data: response, isLoading, refetch } = useBackendApiSalesListSalesOrders();
	const orders = response?.data;
	const customersQuery = useBackendApiMasterdataListCustomers();
	const customers = customersQuery.data?.data ?? [];
	const customerNames = useMemo(
		() => new Map(customers.map((customer) => [customer.id, customer.name])),
		[customers],
	);
	const createMutation = useBackendApiSalesCreateSalesOrder();
	const updateMutation = useBackendApiSalesUpdateSalesOrder();
	const deleteMutation = useBackendApiSalesDeleteSalesOrder();
	const defaultOrderDate = new Date().toISOString().split("T")[0];
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));

	const form = useForm({
		defaultValues: {
			customerId: "",
			orderDate: defaultOrderDate,
			dueDate: "",
			notes: "",
		},
		validators: {
			onChange: salesOrderSchema,
			onSubmit: salesOrderSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = {
					customer_id: value.customerId,
					order_date: value.orderDate,
					due_date: value.dueDate || null,
					notes: value.notes,
					status: selected?.status ?? "draft",
				};
				if (selected) {
					await updateMutation.mutateAsync({ poId: selected.id, data: payload });
				} else {
					await createMutation.mutateAsync({ data: payload });
				}
				toast.success(m.common_mutation_success());
				setUi({ selected: null });
				navigate({ search: (previous) => ({ ...previous, action: undefined }) });
				form.reset();
				await refetch();
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});

	useEffect(() => {
		form.reset(
			selected
				? {
						customerId: selected.customer_id,
						orderDate: selected.order_date,
						dueDate: selected.due_date ?? "",
						notes: selected.notes,
					}
				: {
						customerId: "",
						orderDate: defaultOrderDate,
						dueDate: "",
						notes: "",
					},
		);
	}, [selected, defaultOrderDate, form]);

	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation.mutateAsync({ poId: deleteTarget.id });
			toast.success(m.common_mutation_success());
			setUi({
				selected: selected?.id === deleteTarget.id ? null : selected,
				deleteTarget: null,
			});
			await refetch();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	};
	const salesOrderColumns = useMemo<ColumnDef<SalesPOResponse>[]>(
		() => [
			{
				accessorKey: "po_number",
				header: m.sales_po_number(),
				cell: ({ row }) => (
					<Link
						to="/dashboard/sales/orders/$orderId"
						params={{ orderId: String(row.original.id) }}
						className="font-medium text-primary hover:underline"
					>
						{row.original.po_number}
					</Link>
				),
			},
			{
				accessorKey: "customer_id",
				header: m.sales_customer(),
				cell: ({ row }) => customerNames.get(row.original.customer_id) ?? row.original.customer_id,
			},
			{
				accessorKey: "order_date",
				header: m.common_date(),
			},
			{
				accessorKey: "due_date",
				header: m.common_due_date(),
				cell: ({ row }) => row.original.due_date || m.common_none(),
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
					<SalesOrderActions
						orderId={row.original.id}
						canDelete={canDelete}
						canUpdate={canUpdate}
						onEdit={() => setUi({ selected: row.original })}
						onDelete={() => setUi({ deleteTarget: row.original })}
					/>
				),
			},
		],
		[canDelete, canUpdate, customerNames],
	);

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.sales_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.sales_description()}</p>
				</div>
				{canCreate || canUpdate ? (
					<Sheet
						open={isFormOpen}
						onOpenChange={(open) => {
							if (!open) closeForm();
						}}
					>
						{canCreate ? (
							<SheetTrigger asChild>
								<Button
									type="button"
									onClick={() => {
										setUi({ selected: null });
										navigate({ search: (previous) => ({ ...previous, action: "create" }) });
									}}
								>
									{m.sales_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{selected ? m.common_edit() : m.sales_add()}</SheetTitle>
								<SheetDescription>
									{selected ? m.sales_edit_description() : m.sales_add_description()}
								</SheetDescription>
							</SheetHeader>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void form.handleSubmit();
								}}
								className="mt-6"
							>
								<FieldGroup className="gap-4">
									<form.Field name="customerId">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="sales-customer-id">{m.sales_customer()}</FieldLabel>
													<Select value={field.state.value} onValueChange={field.handleChange}>
														<SelectTrigger id="sales-customer-id" aria-invalid={invalid}>
															<SelectValue placeholder={m.sales_select_customer()} />
														</SelectTrigger>
														<SelectContent>
															<SelectGroup>
																{customers.map((customer) => (
																	<SelectItem key={customer.id} value={customer.id}>
																		{customer.name}
																	</SelectItem>
																))}
															</SelectGroup>
														</SelectContent>
													</Select>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</form.Field>
									<form.Field name="orderDate">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="sales-order-date">{m.sales_order_date()}</FieldLabel>
													<Input
														id="sales-order-date"
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
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="sales-due-date">{m.common_due_date()}</FieldLabel>
													<Input
														id="sales-due-date"
														name={field.name}
														type="date"
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
									<form.Field name="notes">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="sales-notes">{m.common_notes()}</FieldLabel>
													<Textarea
														id="sales-notes"
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
									<form.Subscribe selector={(state) => state.isSubmitting}>
										{(isSubmitting) => (
											<div className="flex flex-col gap-2 sm:flex-row">
												<Button
													type="submit"
													disabled={
														isSubmitting || createMutation.isPending || updateMutation.isPending
													}
												>
													{createMutation.isPending || updateMutation.isPending ? (
														<>
															<Spinner data-icon="inline-start" />
															{m.common_saving()}
														</>
													) : (
														m.common_save()
													)}
												</Button>
												{selected ? (
													<Button type="button" variant="outline" onClick={closeForm}>
														{m.common_cancel()}
													</Button>
												) : null}
											</div>
										)}
									</form.Subscribe>
								</FieldGroup>
							</form>
						</SheetContent>
					</Sheet>
				) : null}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.sales_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : orders?.length ? (
						<DataTable columns={salesOrderColumns} data={orders} getRowId={(order) => order.id} />
					) : (
						<DataEmpty title={m.sales_empty_title()} description={m.sales_empty_description()} />
					)}
				</CardContent>
			</Card>

			<AlertDialog
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => !open && setUi({ deleteTarget: null })}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{m.settings_delete_title()}</AlertDialogTitle>
						<AlertDialogDescription>
							{m.settings_delete_description({ target: deleteTarget?.po_number ?? "" })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{m.common_cancel()}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={deleteMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								void confirmDelete();
							}}
						>
							{deleteMutation.isPending ? (
								<>
									<Spinner data-icon="inline-start" />
									{m.common_saving()}
								</>
							) : (
								m.common_delete()
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function SalesOrderActions({
	orderId,
	canDelete,
	canUpdate,
	onEdit,
	onDelete,
}: {
	orderId: string;
	canDelete: boolean;
	canUpdate: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	return (
		<DropdownMenu>
			<Button variant="ghost" size="icon" asChild>
				<DropdownMenuTrigger aria-label={m.common_more_actions()}>
					<MoreHorizontal />
				</DropdownMenuTrigger>
			</Button>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					<DropdownMenuItem asChild>
						<Link to="/dashboard/sales/orders/$orderId" params={{ orderId }}>
							{m.common_detail()}
						</Link>
					</DropdownMenuItem>
					{canUpdate ? (
						<DropdownMenuItem onSelect={onEdit}>{m.common_edit()}</DropdownMenuItem>
					) : null}
					{canDelete ? (
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={onDelete}
						>
							{m.common_delete()}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
