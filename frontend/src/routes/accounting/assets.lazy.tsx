import { useForm } from "@tanstack/react-form";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceListAssets,
	useBackendApiFinanceRegisterAsset,
} from "@/api/generated/finance/finance";
import type { AssetResponse } from "@/api/generated/models/assetResponse";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { decimalInput, integerInput } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

const assetSchema = z.object({
	name: z.string().min(1, m.assets_name_required()),
	category: z.string().min(1, m.assets_category_required()),
	acquisitionValue: z.string().min(1, m.assets_acquisition_value_required()),
	acquisitionDate: z.string().min(1, m.assets_acquisition_date_required()),
	usefulLifeMonths: z.string().min(1, m.assets_useful_life_required()),
	depreciationStartDate: z.string().min(1, m.assets_depreciation_start_date_required()),
	location: z.string(),
});

const accountingAssetsUiStore = new Store({ createOpen: false });

const assetColumns: ColumnDef<AssetResponse>[] = [
	{
		accessorKey: "asset_code",
		header: m.assets_code(),
		cell: ({ row }) => <span className="font-medium">{row.original.id || "-"}</span>,
	},
	{
		accessorKey: "name",
		header: m.common_name(),
	},
	{
		accessorKey: "category",
		header: m.common_category(),
	},
	{
		accessorKey: "acquisition_value",
		header: m.assets_acquisition_value(),
		cell: ({ row }) => formatCurrency(row.original.acquisition_value || 0),
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

export function AssetsRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.assets.read"]}>
			<AssetsScreen />
		</AccessGuard>
	);
}

function AssetsScreen() {
	const createOpen = useStore(accountingAssetsUiStore, (state) => state.createOpen);
	const setCreateOpen = (open: boolean) =>
		accountingAssetsUiStore.setState((state) => ({ ...state, createOpen: open }));
	const capabilities = useBackendApiAuthGetCapabilities();
	const canManage = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"finance.assets.create",
	);

	const { data: response, isLoading, refetch } = useBackendApiFinanceListAssets();
	const assets = response?.data;

	const createMutation = useBackendApiFinanceRegisterAsset();
	const defaultDate = new Date().toISOString().split("T")[0];

	const form = useForm({
		defaultValues: {
			name: "",
			category: "machinery",
			acquisitionValue: "1000000",
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
			form.reset();
			await refetch();
			setCreateOpen(false);
		},
	});

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.assets_fixed_assets()}</h1>
					<p className="text-sm text-muted-foreground">{m.assets_description()}</p>
				</div>
				{canManage ? (
					<Button type="button" onClick={() => setCreateOpen(true)}>
						{m.assets_register_new()}
					</Button>
				) : null}
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle>{m.assets_list()}</CardTitle>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<DataLoading />
						) : assets?.length ? (
							<DataTable columns={assetColumns} data={assets} getRowId={(a) => a.id} />
						) : (
							<DataEmpty
								title={m.assets_empty_title()}
								description={m.assets_empty_description()}
							/>
						)}
					</CardContent>
				</Card>

				{canManage ? (
					<ActionSheet
						open={canManage && createOpen}
						onOpenChange={setCreateOpen}
						title={m.assets_register_new()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void form.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<form.Field name="name">
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
								</form.Field>

								<form.Field name="category">
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
								</form.Field>

								<form.Field name="acquisitionValue">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="acquisition-value">
													{m.assets_acquisition_value()}
												</FieldLabel>
												<Input
													id="acquisition-value"
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

								<form.Field name="acquisitionDate">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="acquisition-date">
													{m.assets_acquisition_date()}
												</FieldLabel>
												<Input
													id="acquisition-date"
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

								<form.Field name="usefulLifeMonths">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="useful-life">{m.assets_useful_life()}</FieldLabel>
												<Input
													id="useful-life"
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

								<form.Field name="depreciationStartDate">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="depreciation-start-date">
													{m.assets_depreciation_start_date()}
												</FieldLabel>
												<Input
													id="depreciation-start-date"
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

								<form.Subscribe selector={(state) => state.isSubmitting}>
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
								</form.Subscribe>
							</FieldGroup>
						</form>
					</ActionSheet>
				) : null}
			</div>
		</div>
	);
}
