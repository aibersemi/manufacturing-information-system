import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiMasterdataCreateMaterial,
	useBackendApiMasterdataDeleteMaterial,
	useBackendApiMasterdataListMaterials,
	useBackendApiMasterdataListSuppliers,
	useBackendApiMasterdataListUoms,
	useBackendApiMasterdataUpdateMaterial,
} from "@/api/generated/master-data/master-data";
import type { MaterialResponse } from "@/api/generated/models/materialResponse";
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
import { can } from "@/lib/capabilities";
import { decimalInput, optionalDecimalInput } from "@/lib/form-values";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { materialsRoute } from "./materials";

type MaterialFormValue = {
	name: string;
	purchase_uom_id: string;
	usage_uom_id: string;
	moq: string;
	purchase_multiple: string;
	package_quantity: string;
	shrinkage_percent: string;
	default_supplier_id: string;
	last_purchase_price: string;
	status: "active" | "inactive";
};

function formatMaterialDecimal(value: number | string) {
	return formatNumberId(value, { maximumFractionDigits: 4 });
}

export function MaterialsRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.materials.read"]}>
			<MaterialsScreen />
		</AccessGuard>
	);
}

const requiredPositiveDecimal = (message: string) =>
	z
		.string()
		.min(1, message)
		.refine((value) => {
			const parsed = decimalInput(value);
			return Number.isFinite(parsed) && parsed > 0;
		}, message);

const requiredNonNegativeDecimal = (message: string) =>
	z
		.string()
		.min(1, message)
		.refine((value) => {
			const parsed = decimalInput(value);
			return Number.isFinite(parsed) && parsed >= 0;
		}, message);

const optionalNonNegativeDecimal = (message: string) =>
	z.string().refine((value) => {
		if (!value.trim()) return true;
		const parsed = decimalInput(value);
		return Number.isFinite(parsed) && parsed >= 0;
	}, message);

const materialSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, m.materials_name_required())
			.max(255, m.materials_name_max_length()),
		purchase_uom_id: z.string().min(1, m.materials_purchase_uom_required()),
		usage_uom_id: z.string().min(1, m.materials_usage_uom_required()),
		moq: requiredPositiveDecimal(m.materials_moq_required()),
		purchase_multiple: requiredPositiveDecimal(m.materials_purchase_multiple_required()),
		package_quantity: requiredPositiveDecimal(m.materials_package_quantity_required()),
		shrinkage_percent: requiredNonNegativeDecimal(m.materials_shrinkage_percent_required()).refine(
			(value) => decimalInput(value) <= 100,
			m.materials_shrinkage_percent_max(),
		),
		default_supplier_id: z.string(),
		last_purchase_price: optionalNonNegativeDecimal(m.materials_last_purchase_price_invalid()),
		status: z.enum(["active", "inactive"]),
	})
	.superRefine((value, context) => {
		if (
			value.purchase_uom_id &&
			value.purchase_uom_id === value.usage_uom_id &&
			decimalInput(value.package_quantity) !== 1
		) {
			context.addIssue({
				code: "custom",
				path: ["package_quantity"],
				message: m.materials_same_uom_package_quantity(),
			});
		}
	});

function buildMaterialSchema(
	materials: MaterialResponse[],
	selectedId: string | undefined,
	activeSupplierIds: Set<string>,
) {
	return materialSchema.superRefine((value, context) => {
		const normalizedName = value.name.trim().toLocaleLowerCase("id-ID");
		const duplicate = materials.some(
			(material) =>
				material.id !== selectedId &&
				material.name.trim().toLocaleLowerCase("id-ID") === normalizedName,
		);
		if (duplicate) {
			context.addIssue({
				code: "custom",
				path: ["name"],
				message: m.materials_name_duplicate(),
			});
		}
		if (value.default_supplier_id && !activeSupplierIds.has(value.default_supplier_id)) {
			context.addIssue({
				code: "custom",
				path: ["default_supplier_id"],
				message: m.materials_default_supplier_active_required(),
			});
		}
	});
}

function toMaterialPayload(value: MaterialFormValue, schema = materialSchema) {
	const parsed = schema.parse(value);
	return {
		name: parsed.name,
		purchase_uom_id: parsed.purchase_uom_id,
		usage_uom_id: parsed.usage_uom_id,
		moq: decimalInput(parsed.moq),
		purchase_multiple: decimalInput(parsed.purchase_multiple),
		package_quantity: decimalInput(parsed.package_quantity),
		shrinkage_percent: decimalInput(parsed.shrinkage_percent),
		default_supplier_id: parsed.default_supplier_id || undefined,
		last_purchase_price: optionalDecimalInput(parsed.last_purchase_price),
		is_active: parsed.status === "active",
	};
}

function MaterialsScreen() {
	const search = useSearch({ from: materialsRoute.id });
	const navigate = useNavigate({ from: materialsRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as MaterialResponse | null,
				deleteTarget: null as MaterialResponse | null,
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
	const canCreate = can(capabilityList, "masterdata.materials.create");
	const canUpdate = can(capabilityList, "masterdata.materials.update");
	const canDelete = can(capabilityList, "masterdata.materials.delete");
	const canReadUoms = can(capabilityList, "masterdata.uoms.read");
	const { data: response, isLoading, refetch } = useBackendApiMasterdataListMaterials();
	const materials = response?.data;
	const { data: uomsResponse } = useBackendApiMasterdataListUoms();
	const uoms = uomsResponse?.data || [];
	const { data: suppliersResponse } = useBackendApiMasterdataListSuppliers();
	const suppliers = suppliersResponse?.data || [];
	const activeSupplierIds = useMemo(
		() =>
			new Set(suppliers.filter((supplier) => supplier.is_active).map((supplier) => supplier.id)),
		[suppliers],
	);
	const visibleSuppliers = useMemo(
		() =>
			suppliers.filter(
				(supplier) => supplier.is_active || supplier.id === selected?.default_supplier_id,
			),
		[suppliers, selected?.default_supplier_id],
	);
	const materialValidationSchema = useMemo(
		() => buildMaterialSchema(materials || [], selected?.id, activeSupplierIds),
		[materials, selected?.id, activeSupplierIds],
	);
	const createMutation = useBackendApiMasterdataCreateMaterial();
	const updateMutation = useBackendApiMasterdataUpdateMaterial();
	const deleteMutation = useBackendApiMasterdataDeleteMaterial();
	const uomLabelById = useMemo(
		() => new Map(uoms.map((uom) => [uom.id, `${uom.name} (${uom.code})`])),
		[uoms],
	);
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));
	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const form = useForm({
		defaultValues: {
			name: "",
			purchase_uom_id: "",
			usage_uom_id: "",
			moq: "1",
			purchase_multiple: "1",
			package_quantity: "1",
			shrinkage_percent: "0",
			default_supplier_id: "",
			last_purchase_price: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: materialValidationSchema,
			onSubmit: materialValidationSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toMaterialPayload(value, materialValidationSchema);
				if (selected) {
					await updateMutation.mutateAsync({ materialId: selected.id, data: payload });
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
						purchase_uom_id: selected.purchase_uom_id,
						usage_uom_id: selected.usage_uom_id,
						moq: formatMaterialDecimal(selected.moq),
						purchase_multiple: formatMaterialDecimal(selected.purchase_multiple),
						package_quantity: formatMaterialDecimal(selected.package_quantity),
						shrinkage_percent: formatMaterialDecimal(selected.shrinkage_percent),
						default_supplier_id: selected.default_supplier_id ?? "",
						last_purchase_price:
							selected.last_purchase_price === null || selected.last_purchase_price === undefined
								? ""
								: formatMaterialDecimal(selected.last_purchase_price),
						status: selected.is_active ? "active" : "inactive",
					}
				: {
						name: "",
						purchase_uom_id: "",
						usage_uom_id: "",
						moq: "1",
						purchase_multiple: "1",
						package_quantity: "1",
						shrinkage_percent: "0",
						default_supplier_id: "",
						last_purchase_price: "",
						status: "active",
					},
		);
	}, [selected, form]);
	const materialColumns = useMemo<ColumnDef<MaterialResponse>[]>(
		() => [
			{
				accessorKey: "name",
				header: m.materials_name(),
				cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
			},
			{
				accessorKey: "moq",
				header: m.materials_moq(),
				cell: ({ row }) => formatMaterialDecimal(row.original.moq),
			},
			{
				accessorKey: "purchase_multiple",
				header: m.materials_purchase_multiple(),
				cell: ({ row }) => formatMaterialDecimal(row.original.purchase_multiple),
			},
			{
				accessorKey: "purchase_uom_id",
				header: m.materials_purchase_uom(),
				cell: ({ row }) => uomLabelById.get(row.original.purchase_uom_id) ?? "-",
			},
			{
				accessorKey: "package_quantity",
				header: m.materials_package_quantity(),
				cell: ({ row }) => formatMaterialDecimal(row.original.package_quantity),
			},
			{
				accessorKey: "usage_uom_id",
				header: m.materials_usage_uom(),
				cell: ({ row }) => uomLabelById.get(row.original.usage_uom_id) ?? "-",
			},
			{
				accessorKey: "shrinkage_percent",
				header: m.materials_shrinkage_percent(),
				cell: ({ row }) => `${formatMaterialDecimal(row.original.shrinkage_percent)}%`,
			},
			{
				accessorKey: "last_purchase_price",
				header: m.materials_last_purchase_price(),
				cell: ({ row }) =>
					row.original.last_purchase_price === null ||
					row.original.last_purchase_price === undefined
						? "-"
						: formatCurrency(row.original.last_purchase_price),
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
					<MaterialActions
						canDelete={canDelete}
						canUpdate={canUpdate}
						onEdit={() => setUi({ selected: row.original })}
						onDelete={() => setUi({ deleteTarget: row.original })}
					/>
				),
			},
		],
		[canDelete, canUpdate, uomLabelById],
	);
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation.mutateAsync({ materialId: deleteTarget.id });
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
					<h1 className="text-2xl font-bold">{m.materials_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.materials_description()}</p>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row">
					{canReadUoms ? (
						<Button variant="outline" asChild>
							<Link to="/dashboard/masterdata/uoms">{m.materials_uom_settings()}</Link>
						</Button>
					) : null}
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
										{m.materials_add()}
									</Button>
								</SheetTrigger>
							) : null}
							<SheetContent className="overflow-y-auto">
								<SheetHeader>
									<SheetTitle>{selected ? m.common_edit() : m.materials_add()}</SheetTitle>
									<SheetDescription>{m.materials_add_description()}</SheetDescription>
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
														<FieldLabel htmlFor="material-name">{m.materials_name()}</FieldLabel>
														<Input
															id="material-name"
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
										<form.Field name="moq">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-moq">{m.materials_moq()}</FieldLabel>
														<Input
															id="material-moq"
															name={field.name}
															type="text"
															inputMode="decimal"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															required
														/>
														<p className="text-xs text-muted-foreground">
															{m.materials_moq_hint()}
														</p>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="purchase_multiple">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-purchase-multiple">
															{m.materials_purchase_multiple()}
														</FieldLabel>
														<Input
															id="material-purchase-multiple"
															name={field.name}
															type="text"
															inputMode="decimal"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															required
														/>
														<p className="text-xs text-muted-foreground">
															{m.materials_purchase_multiple_hint()}
														</p>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="purchase_uom_id">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-purchase-uom">
															{m.materials_purchase_uom()}
														</FieldLabel>
														<NativeSelect
															id="material-purchase-uom"
															name={field.name}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															required
															className="w-full"
														>
															<NativeSelectOption value="" disabled>
																{m.materials_select_purchase_uom()}
															</NativeSelectOption>
															{uoms.map((uom) => (
																<NativeSelectOption key={uom.id} value={uom.id}>
																	{uom.name} ({uom.code})
																</NativeSelectOption>
															))}
														</NativeSelect>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="package_quantity">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-package-quantity">
															{m.materials_package_quantity()}
														</FieldLabel>
														<Input
															id="material-package-quantity"
															name={field.name}
															type="text"
															inputMode="decimal"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															required
														/>
														<p className="text-xs text-muted-foreground">
															{m.materials_package_quantity_hint()}
														</p>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="usage_uom_id">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-usage-uom">
															{m.materials_usage_uom()}
														</FieldLabel>
														<NativeSelect
															id="material-usage-uom"
															name={field.name}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															required
															className="w-full"
														>
															<NativeSelectOption value="" disabled>
																{m.materials_select_usage_uom()}
															</NativeSelectOption>
															{uoms.map((uom) => (
																<NativeSelectOption key={uom.id} value={uom.id}>
																	{uom.name} ({uom.code})
																</NativeSelectOption>
															))}
														</NativeSelect>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="shrinkage_percent">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-shrinkage-percent">
															{m.materials_shrinkage_percent()}
														</FieldLabel>
														<Input
															id="material-shrinkage-percent"
															name={field.name}
															type="text"
															inputMode="decimal"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															required
														/>
														<p className="text-xs text-muted-foreground">
															{m.materials_shrinkage_percent_hint()}
														</p>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="default_supplier_id">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-default-supplier">
															{m.materials_default_supplier()}
														</FieldLabel>
														<NativeSelect
															id="material-default-supplier"
															name={field.name}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
															className="w-full"
														>
															<NativeSelectOption value="">{m.common_none()}</NativeSelectOption>
															{visibleSuppliers.map((supplier) => (
																<NativeSelectOption key={supplier.id} value={supplier.id}>
																	{supplier.name}
																</NativeSelectOption>
															))}
														</NativeSelect>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="last_purchase_price">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="material-last-purchase-price">
															{m.materials_last_purchase_price()}
														</FieldLabel>
														<Input
															id="material-last-purchase-price"
															name={field.name}
															type="text"
															inputMode="decimal"
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															aria-invalid={invalid}
														/>
														<p className="text-xs text-muted-foreground">
															{m.materials_last_purchase_price_hint()}
														</p>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="status">
											{(field) => (
												<Field>
													<FieldLabel htmlFor="material-status">{m.common_status()}</FieldLabel>
													<NativeSelect
														id="material-status"
														value={field.state.value}
														onChange={(event) =>
															field.handleChange(event.target.value as "active" | "inactive")
														}
														className="w-full"
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
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.materials_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : materials?.length ? (
						<DataTable
							columns={materialColumns}
							data={materials}
							getRowId={(material) => material.id}
						/>
					) : (
						<DataEmpty
							title={m.materials_empty_title()}
							description={m.materials_empty_description()}
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

function MaterialActions({
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
