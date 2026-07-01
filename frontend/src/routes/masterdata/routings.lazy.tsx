import { useForm } from "@tanstack/react-form";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, MoreHorizontal } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiMasterdataCreateRouting,
	useBackendApiMasterdataDeleteRouting,
	useBackendApiMasterdataDuplicateRouting,
	useBackendApiMasterdataListProducts,
	useBackendApiMasterdataListRoutings,
	useBackendApiMasterdataUpdateRouting,
} from "@/api/generated/master-data/master-data";
import type { ProductModelResponse } from "@/api/generated/models/productModelResponse";
import type { RoutingDuplicatePayload } from "@/api/generated/models/routingDuplicatePayload";
import type { RoutingPayload } from "@/api/generated/models/routingPayload";
import type { RoutingResponse } from "@/api/generated/models/routingResponse";
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
import { routingsRoute } from "./routings";

type RoutingFormValue = {
	modelId: string;
	version: string;
	effectiveDate: string;
	status: "active" | "inactive";
};

type RoutingDuplicateFormValue = {
	version: string;
	effectiveDate: string;
	status: "active" | "inactive";
};

export function RoutingsRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.routings.read"]}>
			<RoutingsScreen />
		</AccessGuard>
	);
}

const routingSchema = z.object({
	modelId: z.string().trim().min(1, m.routings_product_model_required()),
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

const routingDuplicateSchema = z.object({
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

function toRoutingPayload(value: RoutingFormValue): RoutingPayload {
	const parsed = routingSchema.parse(value);
	return {
		product_model_id: parsed.modelId,
		version: integerInput(parsed.version),
		effective_date: parsed.effectiveDate,
		is_active: parsed.status === "active",
	};
}

function toRoutingDuplicatePayload(value: RoutingDuplicateFormValue): RoutingDuplicatePayload {
	const parsed = routingDuplicateSchema.parse(value);
	return {
		version: integerInput(parsed.version),
		effective_date: parsed.effectiveDate,
		is_active: parsed.status === "active",
	};
}

function formatModelLabel(modelId: string, modelsById: Map<string, ProductModelResponse>) {
	const model = modelsById.get(modelId);
	return model ? `${model.name} (${model.code})` : modelId;
}

function RoutingsScreen() {
	const search = useSearch({ from: routingsRoute.id });
	const navigate = useNavigate({ from: routingsRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as RoutingResponse | null,
				deleteTarget: null as RoutingResponse | null,
				duplicateTarget: null as RoutingResponse | null,
			}),
		[],
	);
	const ui = useStore(uiStore);
	const { selected, deleteTarget, duplicateTarget } = ui;
	const setUi = (patch: Partial<typeof ui>) =>
		uiStore.setState((state) => ({ ...state, ...patch }));
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "masterdata.routings.create");
	const canUpdate = can(capabilityList, "masterdata.routings.update");
	const canDelete = can(capabilityList, "masterdata.routings.delete");
	const { data: response, isLoading, refetch } = useBackendApiMasterdataListRoutings();
	const routings = response?.data;
	const { data: modelsResponse } = useBackendApiMasterdataListProducts();
	const productModels = modelsResponse?.data || [];
	const modelsById = useMemo(() => {
		return new Map(productModels.map((model) => [model.id, model]));
	}, [productModels]);
	const createMutation = useBackendApiMasterdataCreateRouting();
	const updateMutation = useBackendApiMasterdataUpdateRouting();
	const deleteMutation = useBackendApiMasterdataDeleteRouting();
	const duplicateMutation = useBackendApiMasterdataDuplicateRouting();
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));
	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const form = useForm({
		defaultValues: {
			modelId: "",
			version: "1",
			effectiveDate: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: routingSchema,
			onSubmit: routingSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toRoutingPayload(value);
				if (selected) {
					await updateMutation.mutateAsync({ routingId: selected.id, data: payload });
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
	const duplicateForm = useForm({
		defaultValues: {
			version: "1",
			effectiveDate: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: routingDuplicateSchema,
			onSubmit: routingDuplicateSchema,
		},
		onSubmit: async ({ value }) => {
			if (!duplicateTarget) return;
			try {
				const payload = toRoutingDuplicatePayload(value);
				const result = await duplicateMutation.mutateAsync({
					routingId: duplicateTarget.id,
					data: payload,
				});
				toast.success(m.routings_duplicate_success());
				setUi({ duplicateTarget: null });
				duplicateForm.reset();
				await refetch();
				const nextId = result.status === 200 ? result.data.id : undefined;
				if (nextId) {
					navigate({
						to: "/dashboard/masterdata/routings/$routingId",
						params: { routingId: nextId },
					});
				}
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});
	useEffect(() => {
		form.reset(
			selected
				? {
						modelId: selected.product_model_id,
						version: formatNumberId(selected.version),
						effectiveDate: selected.effective_date,
						status: selected.is_active ? "active" : "inactive",
					}
				: {
						modelId: "",
						version: "1",
						effectiveDate: "",
						status: "active",
					},
		);
	}, [selected, form]);
	useEffect(() => {
		duplicateForm.reset(
			duplicateTarget
				? {
						version: formatNumberId(duplicateTarget.version + 1),
						effectiveDate: "",
						status: "active",
					}
				: {
						version: "1",
						effectiveDate: "",
						status: "active",
					},
		);
	}, [duplicateTarget, duplicateForm]);
	const routingColumns = useMemo<ColumnDef<RoutingResponse>[]>(
		() => [
			{
				accessorKey: "product_model_id",
				header: () => m.routings_product_model(),
				cell: ({ row }) => (
					<Link
						to="/dashboard/masterdata/routings/$routingId"
						params={{ routingId: String(row.original.id) }}
						className="font-medium text-primary hover:underline"
					>
						{formatModelLabel(row.original.product_model_id, modelsById)}
					</Link>
				),
			},
			{
				accessorKey: "version",
				header: () => m.boms_version(),
				cell: ({ row }) => formatNumberId(row.original.version),
			},
			{
				id: "stages",
				header: () => m.routings_production_stage(),
				cell: ({ row }) => m.routings_stage_count({ count: row.original.stages?.length ?? 0 }),
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
					<RoutingActions
						canDuplicate={canCreate}
						canDelete={canDelete}
						canUpdate={canUpdate}
						onDuplicate={() => setUi({ duplicateTarget: row.original })}
						onEdit={() => setUi({ selected: row.original })}
						onDelete={() => setUi({ deleteTarget: row.original })}
					/>
				),
			},
		],
		[canCreate, canDelete, canUpdate, modelsById],
	);
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation.mutateAsync({ routingId: deleteTarget.id });
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
					<h1 className="text-2xl font-bold">{m.routings_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.routings_description()}</p>
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
									{m.routings_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{selected ? m.common_edit() : m.routings_add()}</SheetTitle>
								<SheetDescription>{m.routings_add_initial_detail()}</SheetDescription>
							</SheetHeader>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void form.handleSubmit();
								}}
								className="mt-6"
							>
								<FieldGroup className="gap-4">
									<form.Field name="modelId">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="routing-model">
														{m.routings_product_model()}
													</FieldLabel>
													<NativeSelect
														id="routing-model"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														aria-invalid={invalid}
														className="w-full"
														required
													>
														<NativeSelectOption value="" disabled>
															{m.routings_select_product_model()}
														</NativeSelectOption>
														{productModels.map((model) => (
															<NativeSelectOption key={model.id} value={model.id}>
																{formatModelLabel(model.id, modelsById)}
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
													<FieldLabel htmlFor="routing-version">{m.boms_version()}</FieldLabel>
													<Input
														id="routing-version"
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
													<FieldLabel htmlFor="routing-effective-date">
														{m.boms_effective_date()}
													</FieldLabel>
													<Input
														id="routing-effective-date"
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
												<FieldLabel htmlFor="routing-status">{m.common_status()}</FieldLabel>
												<NativeSelect
													id="routing-status"
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
					<CardTitle>{m.routings_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : routings?.length ? (
						<DataTable
							columns={routingColumns}
							data={routings}
							getRowId={(routing) => routing.id}
						/>
					) : (
						<DataEmpty
							title={m.routings_empty_title()}
							description={m.routings_empty_description()}
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
							{m.settings_delete_description({
								target: deleteTarget
									? formatModelLabel(deleteTarget.product_model_id, modelsById)
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
			<Sheet
				open={Boolean(duplicateTarget)}
				onOpenChange={(open) => !open && setUi({ duplicateTarget: null })}
			>
				<SheetContent className="overflow-y-auto">
					<SheetHeader>
						<SheetTitle>{m.routings_duplicate()}</SheetTitle>
						<SheetDescription>{m.routings_duplicate_description()}</SheetDescription>
					</SheetHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void duplicateForm.handleSubmit();
						}}
						className="mt-6"
					>
						<FieldGroup className="gap-4">
							<duplicateForm.Field name="version">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="routing-duplicate-version">
												{m.boms_version()}
											</FieldLabel>
											<Input
												id="routing-duplicate-version"
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
							</duplicateForm.Field>
							<duplicateForm.Field name="effectiveDate">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="routing-duplicate-effective-date">
												{m.boms_effective_date()}
											</FieldLabel>
											<Input
												id="routing-duplicate-effective-date"
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
							</duplicateForm.Field>
							<duplicateForm.Field name="status">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="routing-duplicate-status">{m.common_status()}</FieldLabel>
										<NativeSelect
											id="routing-duplicate-status"
											name={field.name}
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value as "active" | "inactive")
											}
											onBlur={field.handleBlur}
											className="w-full"
										>
											<NativeSelectOption value="active">{m.common_active()}</NativeSelectOption>
											<NativeSelectOption value="inactive">
												{m.common_inactive()}
											</NativeSelectOption>
										</NativeSelect>
									</Field>
								)}
							</duplicateForm.Field>
							<p className="text-sm text-muted-foreground">
								{m.routings_changes_apply_new_spk_only()}
							</p>
							<duplicateForm.Subscribe selector={(state) => state.isSubmitting}>
								{(isSubmitting) => (
									<div className="flex flex-col gap-2 sm:flex-row">
										<Button
											type="button"
											variant="outline"
											onClick={() => setUi({ duplicateTarget: null })}
										>
											{m.common_cancel()}
										</Button>
										<Button type="submit" disabled={isSubmitting || duplicateMutation.isPending}>
											{duplicateMutation.isPending ? (
												<>
													<Spinner data-icon="inline-start" />
													{m.common_saving()}
												</>
											) : (
												m.routings_duplicate()
											)}
										</Button>
									</div>
								)}
							</duplicateForm.Subscribe>
						</FieldGroup>
					</form>
				</SheetContent>
			</Sheet>
		</div>
	);
}

function RoutingActions({
	canDuplicate,
	canDelete,
	canUpdate,
	onDuplicate,
	onEdit,
	onDelete,
}: {
	canDuplicate: boolean;
	canDelete: boolean;
	canUpdate: boolean;
	onDuplicate: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	if (!canDuplicate && !canUpdate && !canDelete) {
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
					{canDuplicate ? (
						<DropdownMenuItem onSelect={onDuplicate}>
							<Copy />
							{m.routings_duplicate()}
						</DropdownMenuItem>
					) : null}
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
