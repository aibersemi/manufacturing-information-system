import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiLaborListCashAdvances,
	useBackendApiLaborRequestCashAdvance,
} from "@/api/generated/labor/labor";
import { useBackendApiMasterdataListOperators } from "@/api/generated/master-data/master-data";
import type { CashAdvanceResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities";
import { decimalInput, todayInputDate } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { cashAdvancesRoute } from "./cash-advances";

const cashAdvanceColumns: ColumnDef<CashAdvanceResponse>[] = [
	{ accessorKey: "date", header: m.common_date() },
	{ accessorKey: "operator_name", header: m.common_operator() },
	{
		accessorKey: "amount",
		header: m.common_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount),
	},
	{
		accessorKey: "remaining_amount",
		header: m.cash_advances_remaining(),
		cell: ({ row }) => formatCurrency(row.original.remaining_amount),
	},
	{
		accessorKey: "is_paid",
		header: m.common_status(),
		cell: ({ row }) => (
			<Badge variant={row.original.is_paid ? "secondary" : "outline"}>
				{row.original.is_paid ? m.cash_advances_paid() : m.cash_advances_open()}
			</Badge>
		),
	},
	{ accessorKey: "notes", header: m.common_notes(), cell: ({ row }) => row.original.notes || "—" },
];

const cashAdvanceSchema = z.object({
	operatorId: z.string().trim(),
	date: z.string().trim().min(1, m.common_effective_date_required()),
	amount: z
		.string()
		.trim()
		.min(1, m.payments_amount_required())
		.refine((value) => decimalInput(value) > 0, { message: m.payments_amount_positive() }),
	notes: z.string().trim(),
});

export function CashAdvancesRouteScreen() {
	return (
		<AccessGuard anyOf={["labor.cash_advances.read", "labor.cash_advance.self"]}>
			<CashAdvancesScreen />
		</AccessGuard>
	);
}

function CashAdvancesScreen() {
	const search = useSearch({ from: cashAdvancesRoute.id });
	const navigate = useNavigate({ from: cashAdvancesRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canManage = can(capabilityList, "labor.cash_advances.create");
	const advances = useBackendApiLaborListCashAdvances();
	const operators = useBackendApiMasterdataListOperators({
		query: { enabled: canManage },
	});
	const mutation = useBackendApiLaborRequestCashAdvance();
	const isCreateOpen = search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			operatorId: "",
			date: todayInputDate(),
			amount: "",
			notes: "",
		},
		validators: {
			onChange: cashAdvanceSchema,
			onSubmit: cashAdvanceSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					operator_id: value.operatorId,
					date: value.date,
					amount: decimalInput(value.amount),
					notes: value.notes || null,
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: advances.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_cash_advances()}</h1>
					<p className="text-sm text-muted-foreground">{m.cash_advances_description()}</p>
				</div>
				<Button type="button" onClick={openCreate}>
					{m.cash_advances_create_title()}
				</Button>
			</div>

			<ActionSheet
				open={isCreateOpen}
				onOpenChange={(open) => {
					if (!open) closeCreate();
				}}
				title={m.cash_advances_create_title()}
				description={m.cash_advances_create_description()}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<FieldGroup className="gap-4">
						{canManage ? (
							<form.Field name="operatorId">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="cash-advance-operator">{m.common_operator()}</FieldLabel>
										<NativeSelect
											id="cash-advance-operator"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											className="w-full"
											required
										>
											<NativeSelectOption value="">{m.common_select_operator()}</NativeSelectOption>
											{operators.data?.data.map((operator) => (
												<NativeSelectOption key={operator.id} value={operator.id}>
													{operator.name}
												</NativeSelectOption>
											))}
										</NativeSelect>
									</Field>
								)}
							</form.Field>
						) : null}
						<form.Field name="date">
							{(field) => {
								const invalid = field.state.meta.errors.length > 0;
								return (
									<Field data-invalid={invalid}>
										<FieldLabel htmlFor="cash-advance-date">{m.common_date()}</FieldLabel>
										<Input
											id="cash-advance-date"
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
						<form.Field name="amount">
							{(field) => {
								const invalid = field.state.meta.errors.length > 0;
								return (
									<Field data-invalid={invalid}>
										<FieldLabel htmlFor="cash-advance-amount">{m.common_amount()}</FieldLabel>
										<Input
											id="cash-advance-amount"
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
						<form.Field name="notes">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="cash-advance-notes">{m.common_notes()}</FieldLabel>
									<Textarea
										id="cash-advance-notes"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</Field>
							)}
						</form.Field>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button
									type="submit"
									className="md:w-fit"
									disabled={isSubmitting || mutation.isPending}
								>
									{mutation.isPending ? (
										<>
											<Spinner data-icon="inline-start" />
											{m.common_saving()}
										</>
									) : (
										m.cash_advances_submit()
									)}
								</Button>
							)}
						</form.Subscribe>
					</FieldGroup>
				</form>
			</ActionSheet>

			<Card>
				<CardHeader>
					<CardTitle>{m.cash_advances_list_title()}</CardTitle>
				</CardHeader>
				<CardContent>
					{advances.isLoading ? (
						<DataLoading />
					) : advances.isError ? (
						<DataError onRetry={() => void advances.refetch()} />
					) : advances.data?.data.length ? (
						<DataTable
							columns={cashAdvanceColumns}
							data={advances.data.data}
							getRowId={(row) => row.id}
						/>
					) : (
						<DataEmpty
							title={m.cash_advances_empty_title()}
							description={m.cash_advances_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
