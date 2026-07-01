import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiFinanceListPettyCash,
	useBackendApiFinanceRecordPettyCash,
} from "@/api/generated/finance/finance";
import { useBackendApiMasterdataListBankAccounts } from "@/api/generated/master-data/master-data";
import type { PettyCashResponse } from "@/api/generated/models";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataError, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { can } from "@/lib/capabilities";
import { formatCurrency } from "@/lib/i18n";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { pettyCashRoute } from "./petty-cash";

const columns: ColumnDef<PettyCashResponse>[] = [
	{ accessorKey: "date", header: m.common_date() },
	{
		accessorKey: "type",
		header: m.common_type(),
		cell: ({ row }) => (row.original.type === "in" ? m.petty_in() : m.petty_out()),
	},
	{
		accessorKey: "amount",
		header: m.common_amount(),
		cell: ({ row }) => formatCurrency(row.original.amount),
	},
	{
		accessorKey: "category",
		header: m.common_category(),
		cell: ({ row }) => row.original.category || "—",
	},
	{ accessorKey: "status", header: m.common_status() },
	{
		accessorKey: "description",
		header: m.common_description(),
		cell: ({ row }) => row.original.description || "—",
	},
];

export function PettyCashRouteScreen() {
	return (
		<AccessGuard
			anyOf={[
				"finance.petty_cash.read",
				"finance.petty_cash.create",
				"finance.petty_cash.dapur_draft",
			]}
		>
			<PettyCashScreen />
		</AccessGuard>
	);
}

function PettyCashScreen() {
	const search = useSearch({ from: pettyCashRoute.id });
	const navigate = useNavigate({ from: pettyCashRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "finance.petty_cash.create");
	const canDapurDraft = can(capabilityList, "finance.petty_cash.dapur_draft") && !canCreate;
	const canSubmit = canCreate || canDapurDraft;
	const transactions = useBackendApiFinanceListPettyCash();
	const accounts = useBackendApiMasterdataListBankAccounts({
		query: { enabled: canCreate },
	});
	const mutation = useBackendApiFinanceRecordPettyCash();
	const isCreateOpen = canSubmit && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			date: "",
			type: "out",
			amount: "",
			accountId: "",
			fundingMode: "company_fund",
			category: "",
			pic: "",
			description: "",
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					date: value.date,
					type: canDapurDraft ? "out" : value.type,
					amount: value.amount,
					category: value.category,
					description: value.description,
					account_id: canCreate ? value.accountId || undefined : undefined,
					funding_mode: canCreate ? value.fundingMode : "company_fund",
					pic: value.pic,
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: transactions.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.petty_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.petty_description()}</p>
				</div>
				{canSubmit ? (
					<Button type="button" onClick={openCreate}>
						{m.petty_create_title()}
					</Button>
				) : null}
			</div>
			{canSubmit ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.petty_create_title()}
					description={m.petty_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="date">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="petty-date">{m.common_date()}</FieldLabel>
										<Input
											id="petty-date"
											name={field.name}
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											required
										/>
									</Field>
								)}
							</form.Field>
							{canCreate ? (
								<form.Field name="type">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="petty-type">{m.common_type()}</FieldLabel>
											<NativeSelect
												id="petty-type"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
											>
												<NativeSelectOption value="out">{m.petty_expense()}</NativeSelectOption>
												<NativeSelectOption value="in">{m.petty_refill()}</NativeSelectOption>
											</NativeSelect>
										</Field>
									)}
								</form.Field>
							) : null}
							<form.Field name="amount">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="petty-amount">{m.common_amount()}</FieldLabel>
										<Input
											id="petty-amount"
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
							{canCreate ? (
								<form.Field name="accountId">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="petty-account">{m.petty_account()}</FieldLabel>
											<NativeSelect
												id="petty-account"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
											>
												<NativeSelectOption value="">
													{m.petty_account_unselected()}
												</NativeSelectOption>
												{accounts.data?.data.map((account) => (
													<NativeSelectOption key={account.id} value={account.id}>
														{account.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
										</Field>
									)}
								</form.Field>
							) : null}
							{canCreate ? (
								<form.Field name="fundingMode">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="petty-mode">{m.petty_funding_mode()}</FieldLabel>
											<NativeSelect
												id="petty-mode"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
											>
												<NativeSelectOption value="company_fund">
													{m.petty_company_fund()}
												</NativeSelectOption>
												<NativeSelectOption value="advance">{m.petty_advance()}</NativeSelectOption>
												<NativeSelectOption value="reimbursement">
													{m.petty_reimbursement()}
												</NativeSelectOption>
												<NativeSelectOption value="mixed">{m.petty_mixed()}</NativeSelectOption>
											</NativeSelect>
										</Field>
									)}
								</form.Field>
							) : null}
							<form.Field name="category">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="petty-category">{m.common_category()}</FieldLabel>
										<Input
											id="petty-category"
											name={field.name}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											required
										/>
									</Field>
								)}
							</form.Field>
							<form.Field name="pic">
								{(field) => (
									<Field>
										<FieldLabel htmlFor="petty-pic">{m.petty_pic()}</FieldLabel>
										<Input
											id="petty-pic"
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
										<FieldLabel htmlFor="petty-description">
											{m.petty_item_description()}
										</FieldLabel>
										<Input
											id="petty-description"
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
										{m.petty_submit()}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</ActionSheet>
			) : null}
			<Card>
				<CardHeader>
					<CardTitle>{m.petty_history()}</CardTitle>
				</CardHeader>
				<CardContent>
					{transactions.isLoading ? (
						<DataLoading />
					) : transactions.isError ? (
						<DataError onRetry={() => void transactions.refetch()} />
					) : transactions.data?.data.length ? (
						<DataTable columns={columns} data={transactions.data.data} getRowId={(row) => row.id} />
					) : (
						<DataEmpty title={m.petty_empty_title()} description={m.petty_empty_description()} />
					)}
				</CardContent>
			</Card>
		</main>
	);
}
