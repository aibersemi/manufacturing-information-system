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
	useBackendApiMasterdataCreateBom,
	useBackendApiMasterdataDeleteBom,
	useBackendApiMasterdataListBoms,
	useBackendApiMasterdataListProductVariants,
	useBackendApiMasterdataUpdateBom,
} from "@/api/generated/master-data/master-data";
import type { BOMPayload } from "@/api/generated/models/bOMPayload";
import type { BOMResponse } from "@/api/generated/models/bOMResponse";
import type { ProductVariantResponse } from "@/api/generated/models/productVariantResponse";
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
import { integerInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { bomsRoute } from "./boms";

type BomFormValue = {
	variantId: string;
	version: string;
	effectiveDate: string;
	status: "active" | "inactive";
};

export function BomsRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.boms.read"]}>
			<BomsScreen />
		</AccessGuard>
	);
}

const bomSchema = z.object({
	variantId: z.string().trim().min(1, m.boms_product_variant_required()),
	version: z
		.string()
		.trim()
		.min(1, m.boms_version())
		.refine((value) => {
			const parsed = integerInput(value);
			return Number.isInteger(parsed) && parsed >= 1;
		}, m.boms_version()),
	effectiveDate: z.string().trim().min(1, m.common_effective_date_required()),
	status: z.enum(["active", "inactive"]),
});

function toBomPayload(value: BomFormValue): BOMPayload {
	const parsed = bomSchema.parse(value);
	return {
		product_variant_id: parsed.variantId,
		version: integerInput(parsed.version),
		effective_date: parsed.effectiveDate,
		is_active: parsed.status === "active",
	};
}

function formatVariantLabel(variantId: string, variantsById: Map<string, ProductVariantResponse>) {
	const variant = variantsById.get(variantId);
	if (!variant) return variantId;
	const detail = [variant.color, variant.size].filter(Boolean).join(" ");
	return detail ? `${variant.sku} - ${detail}` : variant.sku;
}

function BomsScreen() {
	const search = useSearch({ from: bomsRoute.id });
	const navigate = useNavigate({ from: bomsRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as BOMResponse | null,
				deleteTarget: null as BOMResponse | null,
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
	const canCreate = can(capabilityList, "masterdata.boms.create");
	const canUpdate = can(capabilityList, "masterdata.boms.update");
	const canDelete = can(capabilityList, "masterdata.boms.delete");
	const { data: response, isLoading, refetch } = useBackendApiMasterdataListBoms();
	const boms = response?.data;
	const { data: variantsResponse } = useBackendApiMasterdataListProductVariants();
	const variants = variantsResponse?.data || [];
	const variantsById = useMemo(() => {
		return new Map(variants.map((variant) => [variant.id, variant]));
	}, [variants]);
	const createMutation = useBackendApiMasterdataCreateBom();
	const updateMutation = useBackendApiMasterdataUpdateBom();
	const deleteMutation = useBackendApiMasterdataDeleteBom();
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));
	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const form = useForm({
		defaultValues: {
			variantId: "",
			version: "1",
			effectiveDate: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: bomSchema,
			onSubmit: bomSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toBomPayload(value);
				if (selected) {
					await updateMutation.mutateAsync({ bomId: selected.id, data: payload });
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
						variantId: selected.product_variant_id,
						version: formatNumberId(selected.version),
						effectiveDate: selected.effective_date,
						status: selected.is_active ? "active" : "inactive",
					}
				: {
						variantId: "",
						version: "1",
						effectiveDate: "",
						status: "active",
					},
		);
	}, [selected, form]);
	const bomColumns = useMemo<ColumnDef<BOMResponse>[]>(
		() => [
			{
				accessorKey: "product_variant_id",
				header: () => m.boms_product_variant(),
				cell: ({ row }) => (
					<Link
						to="/dashboard/masterdata/boms/$bomId"
						params={{ bomId: String(row.original.id) }}
						className="font-medium text-primary hover:underline"
					>
						{formatVariantLabel(row.original.product_variant_id, variantsById)}
					</Link>
				),
			},
			{
				accessorKey: "version",
				header: () => m.boms_version(),
				cell: ({ row }) => formatNumberId(row.original.version),
			},
			{
				accessorKey: "effective_date",
				header: () => m.boms_effective_date(),
			},
			{
				accessorKey: "is_active",
				header: () => m.common_status(),
				cell: ({ row }) => (
					<Badge variant={row.original.is_active ? "secondary" : "outline"}>
						{row.original.is_active ? m.common_active() : m.common_inactive()}
					</Badge>
				),
			},
			{
				id: "actions",
				header: () => m.common_action(),
				cell: ({ row }) => (
					<BomActions
						canDelete={canDelete}
						canUpdate={canUpdate}
						onEdit={() => setUi({ selected: row.original })}
						onDelete={() => setUi({ deleteTarget: row.original })}
					/>
				),
			},
		],
		[canDelete, canUpdate, variantsById],
	);
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation.mutateAsync({ bomId: deleteTarget.id });
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
					<h1 className="text-2xl font-bold">{m.boms_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.boms_description()}</p>
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
									{m.boms_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{selected ? m.common_edit() : m.boms_add()}</SheetTitle>
								<SheetDescription>{m.boms_add_initial_detail()}</SheetDescription>
							</SheetHeader>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void form.handleSubmit();
								}}
								className="mt-6"
							>
								<FieldGroup className="gap-4">
									<form.Field name="variantId">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="bom-variant">{m.boms_product_variant()}</FieldLabel>
													<NativeSelect
														id="bom-variant"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														aria-invalid={invalid}
														className="w-full"
														required
													>
														<NativeSelectOption value="" disabled>
															{m.boms_select_product_variant()}
														</NativeSelectOption>
														{variants.map((variant) => (
															<NativeSelectOption key={variant.id} value={variant.id}>
																{formatVariantLabel(variant.id, variantsById)}
															</NativeSelectOption>
														))}
													</NativeSelect>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</form.Field>
									<form.Field name="version">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="bom-version">{m.boms_version()}</FieldLabel>
													<Input
														id="bom-version"
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
									<form.Field name="effectiveDate">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="bom-effective-date">
														{m.boms_effective_date()}
													</FieldLabel>
													<Input
														id="bom-effective-date"
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
									<form.Field name="status">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="bom-status">{m.common_status()}</FieldLabel>
												<NativeSelect
													id="bom-status"
													name={field.name}
													value={field.state.value}
													onChange={(event) =>
														field.handleChange(event.target.value as "active" | "inactive")
													}
													onBlur={field.handleBlur}
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

			<Card>
				<CardHeader>
					<CardTitle>{m.boms_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : boms?.length ? (
						<DataTable columns={bomColumns} data={boms} getRowId={(bom) => bom.id} />
					) : (
						<DataEmpty title={m.boms_empty_title()} description={m.boms_empty_description()} />
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
							{m.settings_delete_description({
								target: deleteTarget
									? formatVariantLabel(deleteTarget.product_variant_id, variantsById)
									: "",
							})}
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

function BomActions({
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
