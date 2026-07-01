import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	getBackendApiMasterdataGetRoutingQueryKey,
	getBackendApiMasterdataListRoutingsQueryKey,
	useBackendApiMasterdataAddRoutingStage,
	useBackendApiMasterdataDeleteRoutingStage,
	useBackendApiMasterdataGetRouting,
	useBackendApiMasterdataListProducts,
	useBackendApiMasterdataUpdateRoutingStage,
} from "@/api/generated/master-data/master-data";
import type { ProductModelResponse } from "@/api/generated/models/productModelResponse";
import type { RoutingStagePayload } from "@/api/generated/models/routingStagePayload";
import type { RoutingStageResponse } from "@/api/generated/models/routingStageResponse";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { integerInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { routingDetailRoute } from "./routings.$routingId";

type TransitionMode = "strict_sequence" | "any_to_any";

type RoutingStageFormValue = {
	sequence: string;
	stageName: string;
	transitionMode: TransitionMode;
	requiresQc: boolean;
};

type RoutingDetailUiState = {
	isStageSheetOpen: boolean;
	editingStage: RoutingStageResponse | null;
	deletingStage: RoutingStageResponse | null;
};

export function RoutingDetailRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.routings.read"]}>
			<RoutingDetailScreen />
		</AccessGuard>
	);
}

const emptyStageForm: RoutingStageFormValue = {
	sequence: "",
	stageName: "",
	transitionMode: "any_to_any",
	requiresQc: false,
};

const routingDetailUiStore = new Store<RoutingDetailUiState>({
	isStageSheetOpen: false,
	editingStage: null,
	deletingStage: null,
});

const routingStageSchema = z.object({
	sequence: z
		.string()
		.trim()
		.min(1, m.routings_sequence_required())
		.refine((value) => {
			const parsed = integerInput(value);
			return Number.isInteger(parsed) && parsed >= 1;
		}, m.routings_sequence_positive()),
	stageName: z.string().trim().min(1, m.routings_stage_name_required()),
	transitionMode: z.enum(["strict_sequence", "any_to_any"]),
	requiresQc: z.boolean(),
});

function toRoutingStagePayload(value: RoutingStageFormValue): RoutingStagePayload {
	const parsed = routingStageSchema.parse(value);
	return {
		sequence: integerInput(parsed.sequence),
		stage_name: parsed.stageName,
		transition_rule: { mode: parsed.transitionMode },
		requires_qc: parsed.requiresQc,
	};
}

function transitionModeFromRule(rule: unknown): TransitionMode {
	if (!rule || typeof rule !== "object") return "any_to_any";
	const mode = (rule as { mode?: unknown }).mode;
	return mode === "strict_sequence" || mode === "any_to_any" ? mode : "any_to_any";
}

function transitionLabel(mode: TransitionMode) {
	return mode === "strict_sequence" ? m.routings_strict_sequence() : m.routings_any_to_any();
}

function formatModelLabel(modelId: string, modelsById: Map<string, ProductModelResponse>) {
	const model = modelsById.get(modelId);
	return model ? `${model.name} (${model.code})` : m.routings_product_model_id({ id: modelId });
}

function RoutingDetailScreen() {
	const { routingId } = useParams({ from: routingDetailRoute.id });
	const queryClient = useQueryClient();
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canAddStage = can(capabilityList, "masterdata.routing_stages.create");
	const canEditStage = can(capabilityList, "masterdata.routing_stages.update");
	const canDeleteStage = can(capabilityList, "masterdata.routing_stages.delete");
	const canOpenStageSheet = canAddStage || canEditStage;

	const { isStageSheetOpen, editingStage, deletingStage } = useStore(
		routingDetailUiStore,
		(state) => state,
	);
	const setStageSheetOpen = (open: boolean) =>
		routingDetailUiStore.setState((state) => ({ ...state, isStageSheetOpen: open }));
	const setEditingStage = (stage: RoutingStageResponse | null) =>
		routingDetailUiStore.setState((state) => ({ ...state, editingStage: stage }));
	const setDeletingStage = (stage: RoutingStageResponse | null) =>
		routingDetailUiStore.setState((state) => ({ ...state, deletingStage: stage }));

	const { data: routingResponse, isLoading: isLoadingRouting } =
		useBackendApiMasterdataGetRouting(routingId);
	const routing = routingResponse?.data;
	const stages = useMemo(
		() => [...(routing?.stages ?? [])].sort((a, b) => a.sequence - b.sequence),
		[routing?.stages],
	);

	const { data: modelsResponse } = useBackendApiMasterdataListProducts();
	const productModels = modelsResponse?.data ?? [];
	const modelsById = useMemo(() => {
		return new Map(productModels.map((model) => [model.id, model]));
	}, [productModels]);

	const { mutateAsync: addRoutingStage, isPending: isAddingStage } =
		useBackendApiMasterdataAddRoutingStage();
	const { mutateAsync: updateRoutingStage, isPending: isUpdatingStage } =
		useBackendApiMasterdataUpdateRoutingStage();
	const { mutateAsync: deleteRoutingStage, isPending: isDeletingStage } =
		useBackendApiMasterdataDeleteRoutingStage();

	const invalidateRoutingQueries = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: getBackendApiMasterdataGetRoutingQueryKey(routingId),
			}),
			queryClient.invalidateQueries({ queryKey: getBackendApiMasterdataListRoutingsQueryKey() }),
		]);
	};

	const form = useForm({
		defaultValues: emptyStageForm,
		validators: {
			onChange: routingStageSchema,
			onSubmit: routingStageSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toRoutingStagePayload(value);
				if (editingStage) {
					await updateRoutingStage({
						routingId,
						stageId: editingStage.id,
						data: payload,
					});
					toast.success(m.routings_stage_updated_success());
				} else {
					await addRoutingStage({ routingId, data: payload });
					toast.success(m.routings_stage_added_success());
				}
				await invalidateRoutingQueries();
				setStageSheetOpen(false);
				setEditingStage(null);
				form.reset(emptyStageForm);
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});

	useEffect(() => {
		if (!isStageSheetOpen) {
			form.reset(emptyStageForm);
			setEditingStage(null);
			return;
		}
		form.reset(
			editingStage
				? {
						sequence: formatNumberId(editingStage.sequence),
						stageName: editingStage.stage_name,
						transitionMode: transitionModeFromRule(editingStage.transition_rule),
						requiresQc: editingStage.requires_qc,
					}
				: emptyStageForm,
		);
	}, [editingStage, form, isStageSheetOpen]);

	const openAddStage = () => {
		setEditingStage(null);
		setStageSheetOpen(true);
	};

	const openEditStage = (stage: RoutingStageResponse) => {
		setEditingStage(stage);
		setStageSheetOpen(true);
	};

	const deleteSelectedStage = async () => {
		if (!deletingStage) return;
		try {
			await deleteRoutingStage({ routingId, stageId: deletingStage.id });
			toast.success(m.routings_stage_deleted_success());
			setDeletingStage(null);
			await invalidateRoutingQueries();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	};

	const stageColumns = useMemo<ColumnDef<RoutingStageResponse>[]>(() => {
		const columns: ColumnDef<RoutingStageResponse>[] = [
			{
				accessorKey: "sequence",
				header: () => m.routings_sequence(),
				cell: ({ row }) => (
					<span className="font-medium">{formatNumberId(row.original.sequence)}</span>
				),
			},
			{
				accessorKey: "stage_name",
				header: () => m.routings_stage_name(),
			},
			{
				accessorKey: "transition_rule",
				header: () => m.routings_transition_rule(),
				cell: ({ row }) => transitionLabel(transitionModeFromRule(row.original.transition_rule)),
			},
			{
				accessorKey: "requires_qc",
				header: () => m.routings_requires_qc(),
				cell: ({ row }) => (
					<Badge variant={row.original.requires_qc ? "secondary" : "outline"}>
						{row.original.requires_qc ? m.common_yes() : m.common_no()}
					</Badge>
				),
			},
		];
		if (canEditStage || canDeleteStage) {
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
									{canEditStage ? (
										<DropdownMenuItem onSelect={() => openEditStage(row.original)}>
											<Pencil />
											{m.common_edit()}
										</DropdownMenuItem>
									) : null}
									{canDeleteStage ? (
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onSelect={() => setDeletingStage(row.original)}
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
	}, [canDeleteStage, canEditStage]);

	if (isLoadingRouting) return <DataLoading />;
	if (!routing) {
		return (
			<DataEmpty
				title={m.routings_not_found_title()}
				description={m.routings_not_found_description()}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex items-center gap-4">
				<Button variant="outline" size="icon" asChild>
					<Link to="/dashboard/masterdata/routings" aria-label={m.common_back()}>
						<ArrowLeft />
					</Link>
				</Button>
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">
						{formatModelLabel(routing.product_model_id, modelsById)}
					</h1>
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>
							{m.routings_detail_prefix()}
							{formatNumberId(routing.version)}
						</span>
						<span>{routing.effective_date}</span>
						<Badge variant={routing.is_active ? "secondary" : "outline"}>
							{routing.is_active ? m.common_active() : m.common_inactive()}
						</Badge>
						<span>{m.routings_stage_count({ count: stages.length })}</span>
					</div>
				</div>
			</div>

			<Card>
				<CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
					<CardTitle>{m.routings_production_stage()}</CardTitle>
					{canOpenStageSheet ? (
						<Sheet
							open={isStageSheetOpen}
							onOpenChange={(open) => {
								setStageSheetOpen(open);
								if (!open) setEditingStage(null);
							}}
						>
							{canAddStage ? (
								<SheetTrigger asChild>
									<Button size="sm" onClick={openAddStage}>
										<Plus data-icon="inline-start" />
										{m.routings_add_production_stage()}
									</Button>
								</SheetTrigger>
							) : null}
							<SheetContent className="overflow-y-auto">
								<SheetHeader>
									<SheetTitle>
										{editingStage ? m.routings_edit_stage() : m.routings_add_production_stage()}
									</SheetTitle>
									<SheetDescription>{m.routings_add_stage_description()}</SheetDescription>
								</SheetHeader>
								<form
									onSubmit={(event) => {
										event.preventDefault();
										event.stopPropagation();
										void form.handleSubmit();
									}}
									className="mt-6"
								>
									<FieldGroup>
										<form.Field name="sequence">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="routing-stage-sequence">
															{m.routings_sequence_number()}
														</FieldLabel>
														<Input
															id="routing-stage-sequence"
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
										<form.Field name="stageName">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="routing-stage-name">
															{m.routings_stage_name()}
														</FieldLabel>
														<Input
															id="routing-stage-name"
															name={field.name}
															type="text"
															placeholder={m.routings_stage_placeholder()}
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
										<form.Field name="transitionMode">
											{(field) => {
												const invalid = field.state.meta.errors.length > 0;
												return (
													<Field data-invalid={invalid}>
														<FieldLabel htmlFor="routing-stage-transition">
															{m.routings_transition_rule()}
														</FieldLabel>
														<Select
															value={field.state.value}
															onValueChange={(value) => field.handleChange(value as TransitionMode)}
														>
															<SelectTrigger id="routing-stage-transition" aria-invalid={invalid}>
																<SelectValue placeholder={m.routings_select_rule()} />
															</SelectTrigger>
															<SelectContent>
																<SelectGroup>
																	<SelectItem value="strict_sequence">
																		{m.routings_strict_sequence()}
																	</SelectItem>
																	<SelectItem value="any_to_any">
																		{m.routings_any_to_any()}
																	</SelectItem>
																</SelectGroup>
															</SelectContent>
														</Select>
														<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
													</Field>
												);
											}}
										</form.Field>
										<form.Field name="requiresQc">
											{(field) => (
												<Field className="flex-row items-center gap-2">
													<Checkbox
														id="routing-stage-requires-qc"
														checked={field.state.value}
														onCheckedChange={(checked) => field.handleChange(checked === true)}
													/>
													<FieldLabel htmlFor="routing-stage-requires-qc">
														{m.routings_requires_qc()}
													</FieldLabel>
												</Field>
											)}
										</form.Field>
										<p className="text-sm text-muted-foreground">
											{m.routings_changes_apply_new_spk_only()}
										</p>
										<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
											{([canSubmit, isSubmitting]) => (
												<SheetFooter>
													<Button
														type="button"
														variant="outline"
														onClick={() => setStageSheetOpen(false)}
													>
														{m.common_cancel()}
													</Button>
													<Button
														type="submit"
														disabled={
															!canSubmit || isSubmitting || isAddingStage || isUpdatingStage
														}
													>
														{isAddingStage || isUpdatingStage ? (
															<>
																<Spinner data-icon="inline-start" />
																{m.common_saving()}
															</>
														) : (
															m.common_save_item()
														)}
													</Button>
												</SheetFooter>
											)}
										</form.Subscribe>
									</FieldGroup>
								</form>
							</SheetContent>
						</Sheet>
					) : null}
				</CardHeader>
				<CardContent>
					{stages.length ? (
						<DataTable columns={stageColumns} data={stages} getRowId={(stage) => stage.id} />
					) : (
						<DataEmpty
							title={m.routings_empty_stages_title()}
							description={m.routings_empty_stages_description()}
						/>
					)}
				</CardContent>
			</Card>

			<AlertDialog
				open={Boolean(deletingStage)}
				onOpenChange={(open) => !open && setDeletingStage(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{m.routings_stage_delete_title()}</AlertDialogTitle>
						<AlertDialogDescription>
							{deletingStage
								? m.routings_stage_delete_description({ stage: deletingStage.stage_name })
								: ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeletingStage}>{m.common_cancel()}</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								disabled={isDeletingStage}
								onClick={(event) => {
									event.preventDefault();
									void deleteSelectedStage();
								}}
							>
								{isDeletingStage ? (
									<>
										<Spinner data-icon="inline-start" />
										{m.common_saving()}
									</>
								) : (
									m.common_delete()
								)}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
