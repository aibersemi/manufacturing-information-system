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
	useBackendApiMasterdataCreateUom,
	useBackendApiMasterdataDeleteUom,
	useBackendApiMasterdataListUoms,
	useBackendApiMasterdataUpdateUom,
} from "@/api/generated/master-data/master-data";
import type { UOMResponse } from "@/api/generated/models/uOMResponse";
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
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { uomsRoute } from "./uoms";

type UomDimension = "count" | "length" | "mass" | "volume";

type UomFormValue = {
	code: string;
	name: string;
	dimension: UomDimension;
};

export function UomsRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.uoms.read"]}>
			<UomsScreen />
		</AccessGuard>
	);
}

const uomDimensions: Array<{ value: UomDimension; label: string }> = [
	{ value: "count", label: "Jumlah" },
	{ value: "length", label: "Panjang" },
	{ value: "mass", label: "Berat" },
	{ value: "volume", label: "Volume" },
];

const uomSchema = z.object({
	code: z.string().min(1, m.materials_code_required()),
	name: z.string().min(1, m.common_name_required()),
	dimension: z.enum(["count", "length", "mass", "volume"]),
});

function formatUomDimension(dimension: string) {
	return uomDimensions.find((option) => option.value === dimension)?.label ?? dimension;
}

function toUomPayload(value: UomFormValue) {
	const parsed = uomSchema.parse(value);
	return {
		code: parsed.code,
		name: parsed.name,
		dimension: parsed.dimension,
	};
}

function UomsScreen() {
	const search = useSearch({ from: uomsRoute.id });
	const navigate = useNavigate({ from: uomsRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selected: null as UOMResponse | null,
				deleteTarget: null as UOMResponse | null,
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
	const canCreate = can(capabilityList, "masterdata.uoms.create");
	const canUpdate = can(capabilityList, "masterdata.uoms.update");
	const canDelete = can(capabilityList, "masterdata.uoms.delete");
	const { data: response, isLoading, refetch } = useBackendApiMasterdataListUoms();
	const uoms = response?.data;
	const createMutation = useBackendApiMasterdataCreateUom();
	const updateMutation = useBackendApiMasterdataUpdateUom();
	const deleteMutation = useBackendApiMasterdataDeleteUom();
	const isFormOpen = (canCreate && search.action === "create") || (canUpdate && Boolean(selected));
	const closeForm = () => {
		setUi({ selected: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		form.reset();
	};
	const form = useForm({
		defaultValues: {
			code: "",
			name: "",
			dimension: "count" as UomDimension,
		},
		validators: {
			onChange: uomSchema,
			onSubmit: uomSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toUomPayload(value);
				if (selected) {
					await updateMutation.mutateAsync({ uomId: selected.id, data: payload });
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
						code: selected.code,
						name: selected.name,
						dimension: uomSchema.shape.dimension.safeParse(selected.dimension).success
							? (selected.dimension as UomDimension)
							: "count",
					}
				: { code: "", name: "", dimension: "count" },
		);
	}, [selected, form]);
	const uomColumns = useMemo<ColumnDef<UOMResponse>[]>(
		() => [
			{
				accessorKey: "code",
				header: m.uoms_code(),
				cell: ({ row }) => <span className="font-medium">{row.original.code}</span>,
			},
			{
				accessorKey: "name",
				header: m.uoms_name(),
			},
			{
				accessorKey: "dimension",
				header: m.uoms_dimension(),
				cell: ({ row }) => formatUomDimension(row.original.dimension),
			},
			{
				id: "actions",
				header: m.common_action(),
				cell: ({ row }) => (
					<UomActions
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
			await deleteMutation.mutateAsync({ uomId: deleteTarget.id });
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
					<h1 className="text-2xl font-bold">{m.uoms_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.uoms_description()}</p>
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
									{m.uoms_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent>
							<SheetHeader>
								<SheetTitle>{selected ? m.common_edit() : m.uoms_add()}</SheetTitle>
								<SheetDescription>{m.uoms_description()}</SheetDescription>
							</SheetHeader>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void form.handleSubmit();
								}}
								className="mt-6"
							>
								<FieldGroup className="gap-4">
									<form.Field name="code">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="uom-code">{m.uoms_code()}</FieldLabel>
													<Input
														id="uom-code"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														placeholder={m.uoms_code_placeholder()}
														aria-invalid={invalid}
														required
													/>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</form.Field>
									<form.Field name="name">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="uom-name">{m.uoms_name()}</FieldLabel>
													<Input
														id="uom-name"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														placeholder={m.uoms_name_placeholder()}
														aria-invalid={invalid}
														required
													/>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</form.Field>
									<form.Field name="dimension">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="uom-dimension">{m.uoms_dimension()}</FieldLabel>
												<NativeSelect
													id="uom-dimension"
													name={field.name}
													value={field.state.value}
													onChange={(event) =>
														field.handleChange(event.target.value as UomDimension)
													}
													onBlur={field.handleBlur}
													className="w-full"
													required
												>
													{uomDimensions.map((option) => (
														<NativeSelectOption key={option.value} value={option.value}>
															{option.label}
														</NativeSelectOption>
													))}
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
					<CardTitle>{m.uoms_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<DataLoading />
					) : uoms?.length ? (
						<DataTable columns={uomColumns} data={uoms} getRowId={(uom) => uom.id} />
					) : (
						<DataEmpty title={m.uoms_empty_title()} description={m.uoms_empty_description()} />
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

function UomActions({
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
