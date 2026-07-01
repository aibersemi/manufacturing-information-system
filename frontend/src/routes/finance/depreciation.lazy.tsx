import { useForm } from "@tanstack/react-form";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";

import {
	useBackendApiFinanceListAssets,
	useBackendApiFinancePostAssetDepreciation,
} from "@/api/generated/finance/finance";
import type { AssetResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";

const depreciationAssetColumns: ColumnDef<AssetResponse>[] = [
	{
		accessorKey: "name",
		header: m.common_name(),
		cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
	},
	{
		accessorKey: "acquisition_value",
		header: m.assets_acquisition_value(),
		cell: ({ row }) => formatCurrency(row.original.acquisition_value),
	},
	{ accessorKey: "depreciation_start_date", header: m.assets_depreciation_start_date() },
	{
		accessorKey: "useful_life_months",
		header: m.assets_useful_life(),
		cell: ({ row }) => formatNumberId(row.original.useful_life_months),
	},
	{
		accessorKey: "status",
		header: m.common_status(),
		cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
	},
];

const depreciationSchema = z.object({
	scheduleId: z.string().trim().min(1, m.asset_depreciation_schedule_required()),
});

export function AssetDepreciationRouteScreen() {
	return (
		<AccessGuard anyOf={["finance.assets.depreciation.post"]}>
			<AssetDepreciationScreen />
		</AccessGuard>
	);
}

function AssetDepreciationScreen() {
	const assets = useBackendApiFinanceListAssets();
	const mutation = useBackendApiFinancePostAssetDepreciation();
	const form = useForm({
		defaultValues: {
			scheduleId: "",
		},
		validators: {
			onChange: depreciationSchema,
			onSubmit: depreciationSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({ scheduleId: value.scheduleId });
			form.reset();
			await queryClient.invalidateQueries({ queryKey: assets.queryKey });
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div>
				<h1 className="text-2xl font-bold">{m.nav_asset_depreciation()}</h1>
				<p className="text-sm text-muted-foreground">{m.asset_depreciation_description()}</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{m.asset_depreciation_post_title()}</CardTitle>
					<CardDescription>{m.asset_depreciation_post_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
							<form.Field name="scheduleId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="depreciation-schedule-id">
												{m.asset_depreciation_schedule_id()}
											</FieldLabel>
											<Input
												id="depreciation-schedule-id"
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
							<form.Subscribe selector={(state) => state.isSubmitting}>
								{(isSubmitting) => (
									<Button
										type="submit"
										className="self-end"
										disabled={isSubmitting || mutation.isPending}
									>
										{mutation.isPending ? (
											<>
												<Spinner data-icon="inline-start" />
												{m.common_saving()}
											</>
										) : (
											m.asset_depreciation_post()
										)}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{m.asset_depreciation_asset_list()}</CardTitle>
				</CardHeader>
				<CardContent>
					{assets.isLoading ? (
						<DataLoading />
					) : assets.isError ? (
						<DataError onRetry={() => void assets.refetch()} />
					) : assets.data?.data.length ? (
						<DataTable
							columns={depreciationAssetColumns}
							data={assets.data.data}
							getRowId={(row) => row.id}
						/>
					) : (
						<DataEmpty title={m.assets_empty_title()} description={m.assets_empty_description()} />
					)}
				</CardContent>
			</Card>
		</main>
	);
}
