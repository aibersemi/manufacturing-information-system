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
	useBackendApiMasterdataCreatePieceRate,
	useBackendApiMasterdataDeletePieceRate,
	useBackendApiMasterdataListPieceRates,
	useBackendApiMasterdataListProducts,
	useBackendApiMasterdataUpdatePieceRate,
} from "@/api/generated/master-data/master-data";
import type { PieceRatePayload } from "@/api/generated/models/pieceRatePayload";
import type { PieceRateResponse } from "@/api/generated/models/pieceRateResponse";
import type { ProductModelResponse } from "@/api/generated/models/productModelResponse";
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
import { decimalInput } from "@/lib/form-values";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { pieceRatesRoute } from "./piece-rates";

type PieceRateRow = PieceRateResponse & {
	location?: string;
	operator_status?: string;
};

type PieceRateFormValue = {
	modelId: string;
	stageName: string;
	rateAmount: string;
	effectiveDate: string;
	changeReason: string;
};

export function PieceRatesRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.piece_rates.read"]}>
			<PieceRatesScreen />
		</AccessGuard>
	);
}

const pieceRateSchema = z.object({
	modelId: z.string().trim().min(1, m.routings_product_model_required()),
	stageName: z.string().trim().min(1, m.routings_stage_name_required()),
	rateAmount: z
		.string()
		.trim()
		.min(1, m.piece_rates_rate_required())
		.refine(
			(value) => {
				const parsed = decimalInput(value);
				return Number.isFinite(parsed) && parsed >= 0;
			},
			{ message: m.piece_rates_rate_required() },
		),
	effectiveDate: z.string().trim().min(1, m.common_effective_date_required()),
	changeReason: z.string().trim(),
});

function toPieceRatePayload(
	value: PieceRateFormValue,
	selected: PieceRateRow | null,
): PieceRatePayload {
	const parsed = pieceRateSchema.parse(value);
	return {
		product_model_id: parsed.modelId,
		stage_name: parsed.stageName,
		rate_amount: String(decimalInput(parsed.rateAmount)),
		effective_date: parsed.effectiveDate,
		operator_id: selected?.operator_id ?? null,
		location: selected?.location ?? "",
		operator_status: selected?.operator_status ?? "",
		change_reason: parsed.changeReason || "Initial setup",
	};
}

function formatModelLabel(modelId: string, modelsById: Map<string, ProductModelResponse>) {
	const model = modelsById.get(modelId);
	return model ? `${model.name} (${model.code})` : modelId;
}

function PieceRatesScreen() {
	const search = useSearch({ from: pieceRatesRoute.id });
	const navigate = useNavigate({ from: pieceRatesRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as PieceRateRow | null,
				deleteTarget: null as PieceRateRow | null,
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
	const canCreate = can(capabilityList, "masterdata.piece_rates.create");
	const canUpdate = can(capabilityList, "masterdata.piece_rates.update");
	const canDelete = can(capabilityList, "masterdata.piece_rates.delete");
	const { data: response, isLoading, refetch } = useBackendApiMasterdataListPieceRates();
	const pieceRates = response?.data as PieceRateRow[] | undefined;
	const { data: modelsResponse } = useBackendApiMasterdataListProducts();
	const productModels = modelsResponse?.data || [];
	const modelsById = useMemo(() => {
		return new Map(productModels.map((model) => [model.id, model]));
	}, [productModels]);
	const createMutation = useBackendApiMasterdataCreatePieceRate();
	const updateMutation = useBackendApiMasterdataUpdatePieceRate();
	const deleteMutation = useBackendApiMasterdataDeletePieceRate();
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));
	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const form = useForm({
		defaultValues: {
			modelId: "",
			stageName: "",
			rateAmount: "",
			effectiveDate: "",
			changeReason: "",
		},
		validators: {
			onChange: pieceRateSchema,
			onSubmit: pieceRateSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toPieceRatePayload(value, selected);
				if (selected) {
					await updateMutation.mutateAsync({ rateId: selected.id, data: payload });
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
						modelId: selected.product_model_id,
						stageName: selected.stage_name,
						rateAmount: formatNumberId(selected.rate_amount, { maximumFractionDigits: 2 }),
						effectiveDate: selected.effective_date,
						changeReason: "",
					}
				: {
						modelId: "",
						stageName: "",
						rateAmount: "",
						effectiveDate: "",
						changeReason: "",
					},
		);
	}, [selected, form]);
	const pieceRateColumns = useMemo<ColumnDef<PieceRateRow>[]>(
		() => [
			{
				accessorKey: "product_model_id",
				header: () => m.routings_product_model(),
				cell: ({ row }) => (
					<span className="font-medium">
						{formatModelLabel(row.original.product_model_id, modelsById)}
					</span>
				),
			},
			{
				accessorKey: "stage_name",
				header: () => m.routings_stage_name(),
			},
			{
				accessorKey: "rate_amount",
				header: () => m.piece_rates_rate_amount(),
				cell: ({ row }) => formatCurrency(row.original.rate_amount),
			},
			{
				accessorKey: "effective_date",
				header: () => m.boms_effective_date(),
			},
			{
				id: "actions",
				header: () => m.common_action(),
				cell: ({ row }) => (
					<PieceRateActions
						canDelete={canDelete}
						canUpdate={canUpdate}
						onEdit={() => setUi({ selected: row.original })}
						onDelete={() => setUi({ deleteTarget: row.original })}
					/>
				),
			},
		],
		[canDelete, canUpdate, modelsById],
	);
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteMutation.mutateAsync({ rateId: deleteTarget.id });
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
					<h1 className="text-2xl font-bold">{m.piece_rates_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.piece_rates_description()}</p>
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
									{m.piece_rates_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{selected ? m.common_edit() : m.piece_rates_add()}</SheetTitle>
								<SheetDescription>{m.piece_rates_add_detail()}</SheetDescription>
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
													<FieldLabel htmlFor="piece-rate-model">
														{m.routings_product_model()}
													</FieldLabel>
													<NativeSelect
														id="piece-rate-model"
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
									<form.Field name="stageName">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="piece-rate-stage">
														{m.routings_stage_name()}
													</FieldLabel>
													<Input
														id="piece-rate-stage"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														placeholder={m.piece_rates_stage_placeholder()}
														aria-invalid={invalid}
														required
													/>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</form.Field>
									<form.Field name="rateAmount">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="piece-rate-amount">
														{m.piece_rates_rate_amount()}
													</FieldLabel>
													<Input
														id="piece-rate-amount"
														name={field.name}
														type="text"
														inputMode="decimal"
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
													<FieldLabel htmlFor="piece-rate-effective-date">
														{m.boms_effective_date()}
													</FieldLabel>
													<Input
														id="piece-rate-effective-date"
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
									<form.Field name="changeReason">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="piece-rate-change-reason">
													{m.piece_rates_change_reason()}
												</FieldLabel>
												<Input
													id="piece-rate-change-reason"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													placeholder={m.piece_rates_change_reason_placeholder()}
												/>
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
					<CardTitle>{m.piece_rates_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : pieceRates?.length ? (
						<DataTable columns={pieceRateColumns} data={pieceRates} getRowId={(rate) => rate.id} />
					) : (
						<DataEmpty
							title={m.piece_rates_empty_title()}
							description={m.piece_rates_empty_description()}
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
									? `${formatModelLabel(deleteTarget.product_model_id, modelsById)} - ${
											deleteTarget.stage_name
										}`
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

function PieceRateActions({
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
