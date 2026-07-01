import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiMasterdataCreateSupplier,
	useBackendApiMasterdataDeleteSupplier,
	useBackendApiMasterdataListSuppliers,
	useBackendApiMasterdataUpdateSupplier,
} from "@/api/generated/master-data/master-data";
import type { SupplierResponse } from "@/api/generated/models/supplierResponse";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { suppliersRoute } from "./suppliers";

export function SuppliersRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.suppliers.read"]}>
			<SuppliersScreen />
		</AccessGuard>
	);
}

const supplierSchema = z.object({
	name: z.string().min(1, m.suppliers_name_required()),
	phone: z.string(),
	address: z.string(),
	status: z.enum(["active", "inactive"]),
});

function SuppliersScreen() {
	const search = useSearch({ from: suppliersRoute.id });
	const navigate = useNavigate({ from: suppliersRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as SupplierResponse | null,
				deleteTarget: null as SupplierResponse | null,
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
	const canCreate = can(capabilityList, "masterdata.suppliers.create");
	const canUpdate = can(capabilityList, "masterdata.suppliers.update");
	const canDelete = can(capabilityList, "masterdata.suppliers.delete");
	const { data: response, isLoading, refetch } = useBackendApiMasterdataListSuppliers();
	const suppliers = response?.data;
	const createMutation = useBackendApiMasterdataCreateSupplier();
	const updateMutation = useBackendApiMasterdataUpdateSupplier();
	const deleteMutation = useBackendApiMasterdataDeleteSupplier();
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));
	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const form = useForm({
		defaultValues: {
			name: "",
			phone: "",
			address: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: supplierSchema,
			onSubmit: supplierSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = {
					name: value.name,
					contact_person: selected?.contact_person ?? "",
					phone: value.phone,
					email: selected?.email ?? "",
					address: value.address,
					is_active: value.status === "active",
				};
				if (selected) {
					await updateMutation.mutateAsync({ supplierId: selected.id, data: payload });
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
						name: selected.name,
						phone: selected.phone,
						address: selected.address,
						status: selected.is_active ? "active" : "inactive",
					}
				: { name: "", phone: "", address: "", status: "active" },
		);
	}, [selected, form]);
	const supplierColumns = useMemo<ColumnDef<SupplierResponse>[]>(
		() => [
			{
				accessorKey: "name",
				header: m.common_name(),
				cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
			},
			{
				accessorKey: "phone",
				header: m.common_phone(),
			},
			{
				accessorKey: "address",
				header: m.common_address(),
				cell: ({ row }) => (
					<span className={row.original.address ? "line-clamp-2" : "text-muted-foreground"}>
						{row.original.address || m.common_none()}
					</span>
				),
			},
			{
				accessorKey: "is_active",
				header: m.common_status(),
				cell: ({ row }) => (
					<Badge variant={row.original.is_active ? "secondary" : "outline"}>
						{row.original.is_active ? m.common_active() : m.common_inactive()}
					</Badge>
				),
			},
			{
				id: "actions",
				header: m.common_action(),
				cell: ({ row }) => (
					<SupplierActions
						canDelete={canDelete}
						canUpdate={canUpdate}
						onEdit={() => setUi({ selected: row.original })}
						onDelete={() => setUi({ deleteTarget: row.original })}
					/>
				),
			},
		],
		[canDelete, canUpdate],
	);
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation.mutateAsync({ supplierId: deleteTarget.id });
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

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.suppliers_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.suppliers_description()}</p>
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
									{m.suppliers_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{selected ? m.common_edit() : m.suppliers_add()}</SheetTitle>
								<SheetDescription>
									{selected ? m.suppliers_edit_description() : m.suppliers_add_description()}
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
									<form.Field name="name">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="supplier-name">
														{m.suppliers_name_label()}
													</FieldLabel>
													<Input
														id="supplier-name"
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
									<form.Field name="phone">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="supplier-phone">{m.common_phone()}</FieldLabel>
													<Input
														id="supplier-phone"
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
									<form.Field name="address">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="supplier-address">{m.common_address()}</FieldLabel>
													<Textarea
														id="supplier-address"
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
									<form.Field name="status">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="supplier-status">{m.common_status()}</FieldLabel>
												<NativeSelect
													id="supplier-status"
													value={field.state.value}
													onChange={(event) =>
														field.handleChange(event.target.value as "active" | "inactive")
													}
												>
													<NativeSelectOption value="active">
														{m.common_active()}
													</NativeSelectOption>
													<NativeSelectOption value="inactive">
														{m.common_inactive()}
													</NativeSelectOption>
												</NativeSelect>
											</Field>
										)}
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
					<CardTitle>{m.suppliers_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : suppliers?.length ? (
						<DataTable
							columns={supplierColumns}
							data={suppliers}
							getRowId={(supplier) => supplier.id}
						/>
					) : (
						<DataEmpty
							title={m.suppliers_empty_title()}
							description={m.suppliers_empty_description()}
						/>
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
							{m.settings_delete_description({ target: deleteTarget?.name ?? "" })}
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

function SupplierActions({
	canDelete,
	canUpdate,
	onEdit,
	onDelete,
}: {
	canDelete: boolean;
	canUpdate: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	if (!canUpdate && !canDelete) {
		return null;
	}
	return (
		<DropdownMenu>
			<Button variant="ghost" size="icon" asChild>
				<DropdownMenuTrigger aria-label={m.common_more_actions()}>
					<MoreHorizontal />
				</DropdownMenuTrigger>
			</Button>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
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
