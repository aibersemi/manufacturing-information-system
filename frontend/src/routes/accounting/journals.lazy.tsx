import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	useBackendApiAccountingCreateJournalEntry,
	useBackendApiAccountingGetFinancialSummary,
	useBackendApiAccountingListAccountingPeriods,
	useBackendApiAccountingListJournals,
} from "@/api/generated/accounting/accounting";
import { useBackendApiMasterdataListChartOfAccounts } from "@/api/generated/master-data/master-data";
import type { JournalEntryResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { decimalInput } from "@/lib/form-values";
import { formatCurrency } from "@/lib/i18n";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { journalsRoute } from "./journals";

const columns: ColumnDef<JournalEntryResponse>[] = [
	{ accessorKey: "date", header: m.common_date() },
	{ accessorKey: "description", header: m.common_description() },
	{
		accessorKey: "reference",
		header: m.common_reference(),
		cell: ({ row }) => row.original.reference || "—",
	},
	{ accessorKey: "status", header: m.common_status() },
];

export function JournalsRouteScreen() {
	return (
		<AccessGuard anyOf={["accounting.journals.read"]}>
			<JournalsScreen />
		</AccessGuard>
	);
}

function JournalsScreen() {
	const search = useSearch({ from: journalsRoute.id });
	const navigate = useNavigate({ from: journalsRoute.id });
	const journals = useBackendApiAccountingListJournals();
	const periods = useBackendApiAccountingListAccountingPeriods();
	const accounts = useBackendApiMasterdataListChartOfAccounts();
	const summary = useBackendApiAccountingGetFinancialSummary();
	const mutation = useBackendApiAccountingCreateJournalEntry();
	const isCreateOpen = search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			periodId: "",
			date: "",
			amount: "",
			debitAccount: "",
			creditAccount: "",
			reference: "",
			description: "",
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					period_id: value.periodId,
					date: value.date,
					description: value.description,
					reference: value.reference,
					lines: [
						{
							account_id: value.debitAccount,
							debit: String(decimalInput(value.amount)),
							credit: "0",
						},
						{
							account_id: value.creditAccount,
							debit: "0",
							credit: String(decimalInput(value.amount)),
						},
					],
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: journals.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.journals_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.journals_description()}</p>
				</div>
				<Button type="button" onClick={openCreate}>
					{m.journals_create_title()}
				</Button>
			</div>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{[
					[m.journals_assets(), summary.data?.data.total_assets],
					[m.journals_liabilities(), summary.data?.data.total_liabilities],
					[m.journals_equity(), summary.data?.data.total_equity],
					[m.journals_net_income(), summary.data?.data.net_income],
				].map(([label, value]) => (
					<Card key={label}>
						<CardHeader>
							<CardDescription>{label}</CardDescription>
							<CardTitle>{formatCurrency(value ?? 0)}</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>
			<ActionSheet
				open={isCreateOpen}
				onOpenChange={(open) => {
					if (!open) closeCreate();
				}}
				title={m.journals_create_title()}
				description={m.journals_create_description()}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<FieldGroup className="gap-4">
						<form.Field name="periodId">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-period">{m.journals_period()}</FieldLabel>
									<NativeSelect
										id="journal-period"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										className="w-full"
										required
									>
										<NativeSelectOption value="">{m.journals_select_period()}</NativeSelectOption>
										{periods.data?.data
											.filter((period) => ["open", "reopened"].includes(period.status))
											.map((period) => (
												<NativeSelectOption key={period.id} value={period.id}>
													{period.name}
												</NativeSelectOption>
											))}
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="date">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-date">{m.common_date()}</FieldLabel>
									<Input
										id="journal-date"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										type="date"
										required
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="amount">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-amount">{m.journals_nominal()}</FieldLabel>
									<Input
										id="journal-amount"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										type="text"
										inputMode="decimal"
										required
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="debitAccount">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-debit">{m.journals_debit_account()}</FieldLabel>
									<NativeSelect
										id="journal-debit"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										className="w-full"
										required
									>
										<NativeSelectOption value="">{m.journals_select_account()}</NativeSelectOption>
										{accounts.data?.data.map((account) => (
											<NativeSelectOption key={account.id} value={account.id}>
												{account.code} — {account.name}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="creditAccount">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-credit">{m.journals_credit_account()}</FieldLabel>
									<NativeSelect
										id="journal-credit"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										className="w-full"
										required
									>
										<NativeSelectOption value="">{m.journals_select_account()}</NativeSelectOption>
										{accounts.data?.data.map((account) => (
											<NativeSelectOption key={account.id} value={account.id}>
												{account.code} — {account.name}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="reference">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-reference">{m.common_reference()}</FieldLabel>
									<Input
										id="journal-reference"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</Field>
							)}
						</form.Field>
						<form.Field name="description">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="journal-description">{m.common_description()}</FieldLabel>
									<Input
										id="journal-description"
										name={field.name}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										required
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
									{m.journals_post()}
								</Button>
							)}
						</form.Subscribe>
					</FieldGroup>
				</form>
			</ActionSheet>
			<Card>
				<CardHeader>
					<CardTitle>{m.journals_history()}</CardTitle>
				</CardHeader>
				<CardContent>
					{journals.isLoading ? (
						<DataLoading />
					) : journals.isError ? (
						<DataError onRetry={() => void journals.refetch()} />
					) : journals.data?.data.length ? (
						<DataTable columns={columns} data={journals.data.data} getRowId={(row) => row.id} />
					) : (
						<DataEmpty
							title={m.journals_empty_title()}
							description={m.journals_empty_description()}
						/>
					)}
				</CardContent>
			</Card>
		</main>
	);
}
