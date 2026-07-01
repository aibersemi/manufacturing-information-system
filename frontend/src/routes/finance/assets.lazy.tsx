import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import {
	useBackendApiFinanceDisposeRegisteredAsset,
	useBackendApiFinanceListAssets,
	useBackendApiFinanceRegisterAsset,
} from "@/api/generated/finance/finance";
import type { AssetResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
	decimalInput,
	integerInput,
	optionalDecimalInput,
	todayInputDate,
} from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { assetsListRoute } from "./assets";

const assetColumns: ColumnDef<AssetResponse>[] = [
	{
		accessorKey: "id",
		header: m.assets_code(),
		cell: ({ row }) => <span className="font-medium">{row.original.id}</span>,
	},
	{ accessorKey: "name", header: m.common_name() },
	{ accessorKey: "category", header: m.common_category() },
	{
		accessorKey: "acquisition_value",
		header: m.assets_acquisition_value(),
		cell: ({ row }) => formatCurrency(row.original.acquisition_value),
	},
	{ accessorKey: "acquisition_date", header: m.assets_acquisition_date() },
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

const assetSchema = z.object({
	name: z.string().trim().min(1, m.assets_name_required()),
	category: z.string().trim().min(1, m.assets_category_required()),
	acquisitionValue: z.string().trim().min(1, m.assets_acquisition_value_required()),
	acquisitionDate: z.string().trim().min(1, m.assets_acquisition_date_required()),
	usefulLifeMonths: z.string().trim().min(1, m.assets_useful_life_required()),
	depreciationStartDate: z.string().trim().min(1, m.assets_depreciation_start_date_required()),
	location: z.string().trim(),
});

const disposalSchema = z.object({
	assetId: z.string().trim().min(1, m.assets_disposal_asset_required()),
	disposalDate: z.string().trim().min(1, m.common_effective_date_required()),
	reason: z.string().trim().min(1, m.common_reason()),
	disposalValue: z.string().trim(),
	proofId: z.string().trim(),
});

export function AssetsListRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.assets.read"]}>
			<AssetsListScreen />
		</AccessGuard>
	);
}

function AssetsListScreen() {
	const search = useSearch({ from: assetsListRoute.id });
	const navigate = useNavigate({ from: assetsListRoute.id });
	const assets = useBackendApiFinanceListAssets();
	const createMutation = useBackendApiFinanceRegisterAsset();
	const disposeMutation = useBackendApiFinanceDisposeRegisteredAsset();
	const defaultDate = todayInputDate();
	const activeAssets = assets.data?.data.filter((asset) => asset.status === "active") ?? [];
	const isCreateOpen = search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const assetForm = useForm({
		defaultValues: {
			name: "",
			category: "",
			acquisitionValue: "",
			acquisitionDate: defaultDate,
			usefulLifeMonths: "60",
			depreciationStartDate: defaultDate,
			location: "",
		},
		validators: {
			onChange: assetSchema,
			onSubmit: assetSchema,
		},
		onSubmit: async ({ value }) => {
			await createMutation.mutateAsync({
				data: {
					name: value.name,
					category: value.category,
					acquisition_value: decimalInput(value.acquisitionValue),
					acquisition_date: value.acquisitionDate,
					useful_life_months: integerInput(value.usefulLifeMonths),
					depreciation_start_date: value.depreciationStartDate,
					location: value.location || null,
				},
			});
			assetForm.reset();
			await queryClient.invalidateQueries({ queryKey: assets.queryKey });
			closeCreate();
		},
	});
	const disposalForm = useForm({
		defaultValues: {
			assetId: "",
			disposalDate: defaultDate,
			reason: "",
			disposalValue: "",
			proofId: "",
		},
		validators: {
			onChange: disposalSchema,
			onSubmit: disposalSchema,
		},
		onSubmit: async ({ value }) => {
			await disposeMutation.mutateAsync({
				assetId: value.assetId,
				data: {
					disposal_date: value.disposalDate,
					reason: value.reason,
					disposal_value: optionalDecimalInput(value.disposalValue),
					proof_id: value.proofId || null,
				},
			});
			disposalForm.reset();
			await queryClient.invalidateQueries({ queryKey: assets.queryKey });
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_assets_list()}</h1>
					<p className="text-sm text-muted-foreground">{m.assets_list_description()}</p>
				</div>
				<Button type="button" onClick={openCreate}>
					{m.assets_register_new()}
				</Button>
			</div>

			<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
				<Card>
					<CardHeader>
						<CardTitle>{m.assets_list()}</CardTitle>
					</CardHeader>
					<CardContent>
						{assets.isLoading ? (
							<DataLoading />
						) : assets.isError ? (
							<DataError onRetry={() => void assets.refetch()} />
						) : assets.data?.data.length ? (
							<DataTable
								columns={assetColumns}
								data={assets.data.data}
								getRowId={(row) => row.id}
							/>
						) : (
							<DataEmpty
								title={m.assets_empty_title()}
								description={m.assets_empty_description()}
							/>
						)}
					</CardContent>
				</Card>

				<div className="flex flex-col gap-6">
					<ActionSheet
						open={isCreateOpen}
						onOpenChange={(open) => {
							if (!open) closeCreate();
						}}
						title={m.assets_register_new()}
						description={m.assets_register_description()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void assetForm.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<assetForm.Field name="name">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="asset-name">{m.assets_name()}</FieldLabel>
												<Input
													id="asset-name"
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
								</assetForm.Field>
								<assetForm.Field name="category">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="asset-category">{m.assets_category()}</FieldLabel>
												<Input
													id="asset-category"
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
								</assetForm.Field>
								<assetForm.Field name="acquisitionValue">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="asset-acquisition-value">
													{m.assets_acquisition_value()}
												</FieldLabel>
												<Input
													id="asset-acquisition-value"
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
								</assetForm.Field>
								<assetForm.Field name="acquisitionDate">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="asset-acquisition-date">
													{m.assets_acquisition_date()}
												</FieldLabel>
												<Input
													id="asset-acquisition-date"
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
								</assetForm.Field>
								<assetForm.Field name="usefulLifeMonths">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="asset-life">{m.assets_useful_life()}</FieldLabel>
												<Input
													id="asset-life"
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
								</assetForm.Field>
								<assetForm.Field name="depreciationStartDate">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="asset-depreciation-start">
													{m.assets_depreciation_start_date()}
												</FieldLabel>
												<Input
													id="asset-depreciation-start"
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
								</assetForm.Field>
								<assetForm.Field name="location">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="asset-location">{m.common_location()}</FieldLabel>
											<Input
												id="asset-location"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</Field>
									)}
								</assetForm.Field>
								<assetForm.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<Button type="submit" disabled={isSubmitting || createMutation.isPending}>
											{createMutation.isPending ? (
												<>
													<Spinner data-icon="inline-start" />
													{m.common_saving()}
												</>
											) : (
												m.common_save()
											)}
										</Button>
									)}
								</assetForm.Subscribe>
							</FieldGroup>
						</form>
					</ActionSheet>

					<Card>
						<CardHeader>
							<CardTitle>{m.assets_disposal_title()}</CardTitle>
							<CardDescription>{m.assets_disposal_description()}</CardDescription>
						</CardHeader>
						<CardContent>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void disposalForm.handleSubmit();
								}}
							>
								<FieldGroup className="gap-4">
									<disposalForm.Field name="assetId">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="disposal-asset">
														{m.assets_disposal_asset()}
													</FieldLabel>
													<NativeSelect
														id="disposal-asset"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														className="w-full"
														aria-invalid={invalid}
														required
													>
														<NativeSelectOption value="">
															{m.assets_disposal_select_asset()}
														</NativeSelectOption>
														{activeAssets.map((asset) => (
															<NativeSelectOption key={asset.id} value={asset.id}>
																{asset.name}
															</NativeSelectOption>
														))}
													</NativeSelect>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</disposalForm.Field>
									<disposalForm.Field name="disposalDate">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="disposal-date">{m.common_date()}</FieldLabel>
													<Input
														id="disposal-date"
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
									</disposalForm.Field>
									<disposalForm.Field name="reason">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="disposal-reason">{m.common_reason()}</FieldLabel>
													<Input
														id="disposal-reason"
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
									</disposalForm.Field>
									<disposalForm.Field name="disposalValue">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="disposal-value">
													{m.assets_disposal_value()}
												</FieldLabel>
												<Input
													id="disposal-value"
													name={field.name}
													type="text"
													inputMode="decimal"
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
												/>
											</Field>
										)}
									</disposalForm.Field>
									<disposalForm.Field name="proofId">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="disposal-proof">
													{m.purchase_payments_proof_id()}
												</FieldLabel>
												<Input
													id="disposal-proof"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
												/>
											</Field>
										)}
									</disposalForm.Field>
									<disposalForm.Subscribe selector={(state) => state.isSubmitting}>
										{(isSubmitting) => (
											<Button
												type="submit"
												variant="outline"
												disabled={isSubmitting || disposeMutation.isPending}
											>
												{disposeMutation.isPending ? (
													<>
														<Spinner data-icon="inline-start" />
														{m.common_saving()}
													</>
												) : (
													m.assets_disposal_submit()
												)}
											</Button>
										)}
									</disposalForm.Subscribe>
								</FieldGroup>
							</form>
						</CardContent>
					</Card>
				</div>
			</div>
		</main>
	);
}
