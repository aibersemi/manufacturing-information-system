import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	getBackendApiMasterdataGetBomQueryKey,
	useBackendApiMasterdataAddBomItem,
	useBackendApiMasterdataDeleteBomItem,
	useBackendApiMasterdataGetBom,
	useBackendApiMasterdataListMaterials,
	useBackendApiMasterdataUpdateBomItem,
} from "@/api/generated/master-data/master-data";
import type { BOMDetailItemResponse } from "@/api/generated/models/bOMDetailItemResponse";
import type { BOMDetailResponse } from "@/api/generated/models/bOMDetailResponse";
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
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { can } from "@/lib/capabilities";
import { decimalInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import * as m from "@/paraglide/messages";
import { bomDetailRoute } from "./boms.$bomId";

export function BomDetailRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.boms.read"]}>
			<BomDetailScreen />
		</AccessGuard>
	);
}

const emptyItemForm = {
	materialId: "",
	quantity: "",
};

type BomItemUiState = {
	isItemSheetOpen: boolean;
	editingItem: BOMDetailItemResponse | null;
	deletingItem: BOMDetailItemResponse | null;
};

const bomItemUiStore = new Store<BomItemUiState>({
	isItemSheetOpen: false,
	editingItem: null,
	deletingItem: null,
});

function formatVariantTitle(bom: BOMDetailResponse) {
	const detail = [bom.product_variant.color, bom.product_variant.size].filter(Boolean).join(" ");
	return detail ? `${bom.product_variant.sku} - ${detail}` : bom.product_variant.sku;
}

function formatYield(value: unknown) {
	if (typeof value === "number") return formatNumberId(value);
	if (typeof value === "string" && value.trim()) return formatNumberId(value);
	return null;
}

function BomDetailScreen() {
	const { bomId } = useParams({ from: bomDetailRoute.id });
	const queryClient = useQueryClient();
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canAddItem = can(capabilityList, "masterdata.bom_items.create");
	const canEditItem = can(capabilityList, "masterdata.bom_items.update");
	const canDeleteItem = can(capabilityList, "masterdata.bom_items.delete");
	const canOpenItemSheet = canAddItem || canEditItem;
	const { isItemSheetOpen, editingItem, deletingItem } = useStore(bomItemUiStore, (state) => state);

	const setItemSheetOpen = (open: boolean) =>
		bomItemUiStore.setState((state) => ({ ...state, isItemSheetOpen: open }));
	const setEditingItem = (item: BOMDetailItemResponse | null) =>
		bomItemUiStore.setState((state) => ({ ...state, editingItem: item }));
	const setDeletingItem = (item: BOMDetailItemResponse | null) =>
		bomItemUiStore.setState((state) => ({ ...state, deletingItem: item }));

	const { data: bomResponse, isLoading: isLoadingBom } = useBackendApiMasterdataGetBom(bomId);
	const bom = bomResponse?.data;
	const estimatedYield = formatYield(bom?.product_variant.metadata.estimated_yield_per_rjn_roll);

	const { data: materialsResponse } = useBackendApiMasterdataListMaterials();
	const materials = materialsResponse?.data || [];
	const materialById = useMemo(
		() => new Map(materials.map((material) => [material.id, material])),
		[materials],
	);

	const { mutateAsync: addBomItem } = useBackendApiMasterdataAddBomItem();
	const { mutateAsync: updateBomItem } = useBackendApiMasterdataUpdateBomItem();
	const { mutateAsync: deleteBomItem, isPending: isDeletingItem } =
		useBackendApiMasterdataDeleteBomItem();

	const form = useForm({
		defaultValues: emptyItemForm,
		onSubmit: async ({ value }) => {
			const quantity = decimalInput(value.quantity);
			if (!Number.isFinite(quantity) || quantity <= 0) {
				toast.error(m.boms_quantity_positive());
				return;
			}
			try {
				if (editingItem) {
					await updateBomItem({
						bomId,
						itemId: editingItem.id,
						data: { quantity },
					});
					toast.success(m.boms_item_updated_success());
				} else {
					await addBomItem({
						bomId,
						data: {
							material_id: value.materialId,
							quantity,
						},
					});
					toast.success(m.boms_item_added_success());
				}
				await queryClient.invalidateQueries({
					queryKey: getBackendApiMasterdataGetBomQueryKey(bomId),
				});
				setItemSheetOpen(false);
				setEditingItem(null);
				form.reset(emptyItemForm);
			} catch (_error) {
				toast.error(m.common_mutation_error());
			}
		},
	});

	useEffect(() => {
		if (!isItemSheetOpen) {
			form.reset(emptyItemForm);
			setEditingItem(null);
			return;
		}
		form.reset(
			editingItem
				? {
						materialId: editingItem.material_id,
						quantity: formatNumberId(editingItem.quantity, { maximumFractionDigits: 4 }),
					}
				: emptyItemForm,
		);
	}, [editingItem, form, isItemSheetOpen]);

	const openAddItem = () => {
		setEditingItem(null);
		setItemSheetOpen(true);
	};

	const openEditItem = (item: BOMDetailItemResponse) => {
		setEditingItem(item);
		setItemSheetOpen(true);
	};

	const deleteSelectedItem = async () => {
		if (!deletingItem) return;
		try {
			await deleteBomItem({ bomId, itemId: deletingItem.id });
			toast.success(m.boms_item_deleted_success());
			setDeletingItem(null);
			await queryClient.invalidateQueries({
				queryKey: getBackendApiMasterdataGetBomQueryKey(bomId),
			});
		} catch (_error) {
			toast.error(m.common_mutation_error());
		}
	};

	const itemColumns = useMemo<ColumnDef<BOMDetailItemResponse>[]>(() => {
		const columns: ColumnDef<BOMDetailItemResponse>[] = [
			{
				accessorKey: "material_name",
				header: () => m.materials_name(),
				cell: ({ row }) => <span className="font-medium">{row.original.material_name}</span>,
			},
			{
				accessorKey: "quantity",
				header: () => m.boms_qty_per_piece(),
				cell: ({ row }) => (
					<span>
						{formatNumberId(row.original.quantity, { maximumFractionDigits: 4 })}{" "}
						{row.original.usage_uom_code}
					</span>
				),
			},
		];
		if (canEditItem || canDeleteItem) {
			columns.push({
				id: "actions",
				header: () => <span className="sr-only">{m.common_action()}</span>,
				cell: ({ row }) => (
					<div className="flex justify-end">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" aria-label={m.common_more_actions()}>
									<MoreHorizontal />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuGroup>
									{canEditItem ? (
										<DropdownMenuItem onSelect={() => openEditItem(row.original)}>
											<Pencil />
											{m.common_edit()}
										</DropdownMenuItem>
									) : null}
									{canDeleteItem ? (
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onSelect={() => setDeletingItem(row.original)}
										>
											<Trash2 />
											{m.common_delete()}
										</DropdownMenuItem>
									) : null}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				),
			});
		}
		return columns;
	}, [canDeleteItem, canEditItem]);

	if (isLoadingBom) return <DataLoading />;
	if (!bom)
		return (
			<DataEmpty title={m.boms_not_found_title()} description={m.boms_not_found_description()} />
		);

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex items-center gap-4">
				<Button variant="outline" size="icon" asChild>
					<Link to="/dashboard/masterdata/boms" aria-label={m.common_back()}>
						<ArrowLeft />
					</Link>
				</Button>
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{formatVariantTitle(bom)}</h1>
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>
							{m.boms_detail_prefix()}
							{bom.version}
						</span>
						<span>{bom.effective_date}</span>
						<Badge variant={bom.is_active ? "secondary" : "outline"}>
							{bom.is_active ? m.common_active() : m.common_inactive()}
						</Badge>
						{estimatedYield ? (
							<span>
								{m.boms_estimated_yield()}:{" "}
								{m.boms_estimated_yield_value({ quantity: estimatedYield })}
							</span>
						) : null}
					</div>
				</div>
			</div>

			<Card>
				<CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
					<CardTitle>{m.boms_formula_items_per_piece()}</CardTitle>
					{canOpenItemSheet ? (
						<Sheet
							open={isItemSheetOpen}
							onOpenChange={(open) => {
								setItemSheetOpen(open);
								if (!open) setEditingItem(null);
							}}
						>
							{canAddItem ? (
								<SheetTrigger asChild>
									<Button size="sm" onClick={openAddItem}>
										<Plus data-icon="inline-start" />
										{m.boms_add_raw_material()}
									</Button>
								</SheetTrigger>
							) : null}
							<SheetContent>
								<SheetHeader>
									<SheetTitle>
										{editingItem ? m.boms_edit_raw_material() : m.boms_add_raw_material()}
									</SheetTitle>
									<SheetDescription>
										{editingItem ? m.boms_edit_item_description() : m.boms_add_item_description()}
									</SheetDescription>
								</SheetHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										e.stopPropagation();
										form.handleSubmit();
									}}
									className="mt-6"
								>
									<FieldGroup>
										{editingItem ? (
											<Field>
												<FieldLabel htmlFor="bom-item-material-readonly">
													{m.common_material()}
												</FieldLabel>
												<Input
													id="bom-item-material-readonly"
													value={editingItem.material_name}
													disabled
												/>
												<p className="text-sm text-muted-foreground">
													{m.boms_material_locked_after_create()}
												</p>
											</Field>
										) : (
											<form.Field
												name="materialId"
												validators={{
													onChange: ({ value }) =>
														!value ? m.boms_material_required() : undefined,
												}}
												children={(field) => {
													const hasError = field.state.meta.errors.length > 0;
													return (
														<Field data-invalid={hasError}>
															<FieldLabel htmlFor={field.name}>{m.common_material()}</FieldLabel>
															<Select value={field.state.value} onValueChange={field.handleChange}>
																<SelectTrigger id={field.name} aria-invalid={hasError}>
																	<SelectValue placeholder={m.boms_select_material()} />
																</SelectTrigger>
																<SelectContent>
																	<SelectGroup>
																		{materials.map((material) => (
																			<SelectItem key={material.id} value={material.id}>
																				{material.name}
																			</SelectItem>
																		))}
																	</SelectGroup>
																</SelectContent>
															</Select>
															<FieldError>{field.state.meta.errors.join(", ")}</FieldError>
														</Field>
													);
												}}
											/>
										)}
										<form.Field
											name="quantity"
											validators={{
												onChange: ({ value }) => {
													const quantity = decimalInput(value);
													if (!value) return m.common_quantity_required();
													return Number.isFinite(quantity) && quantity > 0
														? undefined
														: m.boms_quantity_positive();
												},
											}}
											children={(field) => {
												const hasError = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={hasError}>
														<FieldLabel htmlFor={field.name}>{m.common_quantity()}</FieldLabel>
														<Input
															id={field.name}
															type="text"
															inputMode="decimal"
															value={field.state.value}
															onChange={(e) => field.handleChange(e.target.value)}
															aria-invalid={hasError}
															required
														/>
														<FieldError>{field.state.meta.errors.join(", ")}</FieldError>
														<form.Subscribe
															selector={(state) => state.values.materialId}
															children={(materialId) => {
																const usageUomCode =
																	editingItem?.usage_uom_code ??
																	materialById.get(materialId)?.usage_uom_code;
																return (
																	<p className="text-sm text-muted-foreground">
																		{usageUomCode
																			? `${m.boms_usage_uom()}: ${usageUomCode}`
																			: m.boms_select_material_for_usage_uom()}
																	</p>
																);
															}}
														/>
													</Field>
												);
											}}
										/>
										<p className="text-sm text-muted-foreground">
											{m.boms_changes_apply_new_spk_only()}
										</p>
										<form.Subscribe
											selector={(state) => [state.canSubmit, state.isSubmitting]}
											children={([canSubmit, isSubmitting]) => (
												<SheetFooter>
													<Button
														type="button"
														variant="outline"
														onClick={() => setItemSheetOpen(false)}
													>
														{m.common_cancel()}
													</Button>
													<Button type="submit" disabled={!canSubmit || isSubmitting}>
														{isSubmitting ? m.common_saving() : m.common_save_item()}
													</Button>
												</SheetFooter>
											)}
										/>
									</FieldGroup>
								</form>
							</SheetContent>
						</Sheet>
					) : null}
				</CardHeader>
				<CardContent>
					<DataTable columns={itemColumns} data={bom.items} getRowId={(item) => item.id} />
				</CardContent>
			</Card>
			<AlertDialog
				open={Boolean(deletingItem)}
				onOpenChange={(open) => !open && setDeletingItem(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{m.boms_delete_item_title()}</AlertDialogTitle>
						<AlertDialogDescription>
							{deletingItem
								? m.boms_delete_item_description({ material: deletingItem.material_name })
								: ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeletingItem}>{m.common_cancel()}</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								disabled={isDeletingItem}
								onClick={(event) => {
									event.preventDefault();
									void deleteSelectedItem();
								}}
							>
								{isDeletingItem ? m.common_saving() : m.common_delete()}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
