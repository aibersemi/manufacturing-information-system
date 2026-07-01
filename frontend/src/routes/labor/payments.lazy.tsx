import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiLaborCreatePieceRatePayment } from "@/api/generated/labor/labor";
import {
	useBackendApiMasterdataListBankAccounts,
	useBackendApiMasterdataListOperators,
} from "@/api/generated/master-data/master-data";
import type { WorkLogResponse } from "@/api/generated/models";
import { useBackendApiProductionListWorkLogs } from "@/api/generated/production/production";
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
import { splitIdList } from "@/lib/form-values";
import { formatCurrency, formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { queryClient } from "../root";
import { pieceRatePaymentsRoute } from "./payments";

const payableLogColumns: ColumnDef<WorkLogResponse>[] = [
	{ accessorKey: "id", header: m.common_id(), cell: ({ row }) => row.original.id },
	{ accessorKey: "operator_id", header: m.common_operator() },
	{
		accessorKey: "qty_claimed",
		header: m.operator_work_logs_claimed_qty(),
		cell: ({ row }) => formatNumberId(row.original.qty_claimed),
	},
	{
		accessorKey: "amount_total",
		header: m.common_total(),
		cell: ({ row }) => formatCurrency(row.original.amount_total),
	},
	{
		accessorKey: "is_verified",
		header: m.operator_work_logs_verified(),
		cell: ({ row }) => (
			<Badge variant={row.original.is_verified ? "secondary" : "outline"}>
				{row.original.is_verified ? m.common_yes() : m.common_no()}
			</Badge>
		),
	},
];

const pieceRatePaymentSchema = z.object({
	operatorId: z.string().trim().min(1, m.production_progress_operator_required()),
	workLogIds: z.string().trim().min(1, m.piece_rate_payments_work_logs_required()),
	accountId: z.string().trim().min(1, m.purchase_payments_account_required()),
	proofId: z.string().trim().min(1, m.piece_rate_payments_proof_required()),
});

export function PieceRatePaymentsRouteScreen() {
	return (
		<AccessGuard anyOf={["labor.piece_rate.pay"]}>
			<PieceRatePaymentsScreen />
		</AccessGuard>
	);
}

function PieceRatePaymentsScreen() {
	const search = useSearch({ from: pieceRatePaymentsRoute.id });
	const navigate = useNavigate({ from: pieceRatePaymentsRoute.id });
	const payableLogs = useBackendApiProductionListWorkLogs({
		is_verified: true,
		is_paid: false,
	});
	const operators = useBackendApiMasterdataListOperators();
	const accounts = useBackendApiMasterdataListBankAccounts();
	const mutation = useBackendApiLaborCreatePieceRatePayment();
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
			workLogIds: "",
			accountId: "",
			proofId: "",
		},
		validators: {
			onChange: pieceRatePaymentSchema,
			onSubmit: pieceRatePaymentSchema,
		},
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				data: {
					operator_id: value.operatorId,
					work_log_ids: splitIdList(value.workLogIds),
					paid_rates: {},
					adjustment_reasons: {},
					account_id: value.accountId,
					proof_id: value.proofId,
				},
			});
			form.reset();
			await queryClient.invalidateQueries({ queryKey: payableLogs.queryKey });
			closeCreate();
		},
	});

	return (
		<main className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.nav_piece_rate_payments()}</h1>
					<p className="text-sm text-muted-foreground">{m.piece_rate_payments_description()}</p>
				</div>
				<Button type="button" onClick={openCreate}>
					{m.piece_rate_payments_create_title()}
				</Button>
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle>{m.piece_rate_payments_payable_title()}</CardTitle>
					</CardHeader>
					<CardContent>
						{payableLogs.isLoading ? (
							<DataLoading />
						) : payableLogs.isError ? (
							<DataError onRetry={() => void payableLogs.refetch()} />
						) : payableLogs.data?.data.length ? (
							<DataTable
								columns={payableLogColumns}
								data={payableLogs.data.data}
								getRowId={(row) => row.id}
							/>
						) : (
							<DataEmpty
								title={m.piece_rate_payments_empty_title()}
								description={m.piece_rate_payments_empty_description()}
							/>
						)}
					</CardContent>
				</Card>
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.piece_rate_payments_create_title()}
					description={m.piece_rate_payments_create_description()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="operatorId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="piece-payment-operator">
												{m.common_operator()}
											</FieldLabel>
											<NativeSelect
												id="piece-payment-operator"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.common_select_operator()}
												</NativeSelectOption>
												{operators.data?.data.map((operator) => (
													<NativeSelectOption key={operator.id} value={operator.id}>
														{operator.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="workLogIds">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="piece-payment-work-logs">
												{m.piece_rate_payments_work_logs()}
											</FieldLabel>
											<Textarea
												id="piece-payment-work-logs"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												placeholder={m.piece_rate_payments_work_logs_placeholder()}
												aria-invalid={invalid}
												required
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="accountId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="piece-payment-account">
												{m.purchase_payments_account()}
											</FieldLabel>
											<NativeSelect
												id="piece-payment-account"
												name={field.name}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
												className="w-full"
												aria-invalid={invalid}
												required
											>
												<NativeSelectOption value="">
													{m.purchase_payments_select_account()}
												</NativeSelectOption>
												{accounts.data?.data.map((account) => (
													<NativeSelectOption key={account.id} value={account.id}>
														{account.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="proofId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="piece-payment-proof">
												{m.purchase_payments_proof_id()}
											</FieldLabel>
											<Input
												id="piece-payment-proof"
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
									<Button type="submit" disabled={isSubmitting || mutation.isPending}>
										{mutation.isPending ? (
											<>
												<Spinner data-icon="inline-start" />
												{m.common_saving()}
											</>
										) : (
											m.piece_rate_payments_submit()
										)}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</ActionSheet>
			</div>
		</main>
	);
}
