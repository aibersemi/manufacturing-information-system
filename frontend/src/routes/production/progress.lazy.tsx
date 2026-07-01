import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import { useBackendApiMasterdataListOperators } from "@/api/generated/master-data/master-data";
import { useBackendApiProductionCreateStageProgress } from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { integerInput } from "@/lib/form-values";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { productionProgressRoute } from "./progress";

const progressSchema = z.object({
	jobPacketId: z.string().min(1, m.production_progress_job_packet_required()),
	stageId: z.string().min(1, m.production_progress_stage_required()),
	operatorId: z.string().min(1, m.production_progress_operator_required()),
	qtyGood: z.string().min(1, m.common_quantity_required()),
});

export function ProductionProgressRouteScreen() {
	return (
		<AccessGuard anyOf={["production.progress.submit.assigned", "production.progress.create"]}>
			<ProductionProgressScreen />
		</AccessGuard>
	);
}

function ProductionProgressScreen() {
	const search = useSearch({ from: productionProgressRoute.id });
	const navigate = useNavigate({ from: productionProgressRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canManage = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"production.progress.create",
	);

	const createMutation = useBackendApiProductionCreateStageProgress();
	const { data: operatorsResponse } = useBackendApiMasterdataListOperators();
	const operators = operatorsResponse?.data || [];
	const isCreateOpen = canManage && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};

	const form = useForm({
		defaultValues: {
			jobPacketId: "",
			stageId: "",
			operatorId: "",
			qtyGood: "10",
		},
		validators: {
			onChange: progressSchema,
			onSubmit: progressSchema,
		},
		onSubmit: async ({ value }) => {
			await createMutation.mutateAsync({
				data: {
					job_packet_id: value.jobPacketId,
					stage_id: value.stageId,
					operator_id: value.operatorId,
					qty_good: integerInput(value.qtyGood),
					qty_in: integerInput(value.qtyGood),
				},
			});
			form.reset();
			closeCreate();
		},
	});

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.nav_production_progress()}</h1>
					<p className="text-sm text-muted-foreground">{m.production_progress_description()}</p>
				</div>
				{canManage ? (
					<Button type="button" onClick={openCreate}>
						{m.production_progress_add()}
					</Button>
				) : null}
			</div>

			{canManage ? (
				<ActionSheet
					open={isCreateOpen}
					onOpenChange={(open) => {
						if (!open) closeCreate();
					}}
					title={m.production_progress_add()}
				>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<FieldGroup className="gap-4">
							<form.Field name="jobPacketId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="job-packet-id">
												{m.production_progress_job_packet_id()}
											</FieldLabel>
											<Input
												id="job-packet-id"
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
							<form.Field name="stageId">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="stage-id">{m.production_progress_stage_id()}</FieldLabel>
											<Input
												id="stage-id"
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
							<form.Field name="operatorId">
								{(field) => {
									const _invalid = field.state.meta.errors.length > 0;
									return (
										<div className="flex flex-col gap-2">
											<FieldLabel htmlFor="operator-id">{m.common_operator()}</FieldLabel>
											<Select value={field.state.value} onValueChange={field.handleChange}>
												<SelectTrigger id="operator-id">
													<SelectValue placeholder={m.common_select_operator()} />
												</SelectTrigger>
												<SelectContent>
													{operators.map((op) => (
														<SelectItem key={op.id} value={op.id}>
															{op.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</div>
									);
								}}
							</form.Field>
							<form.Field name="qtyGood">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="qty-good">
												{m.production_progress_good_quantity()}
											</FieldLabel>
											<Input
												id="qty-good"
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
	);
}
