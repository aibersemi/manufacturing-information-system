import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import type { JobPacketResponse } from "@/api/generated/models/jobPacketResponse";
import {
	useBackendApiProductionCreateJobPacket,
	useBackendApiProductionListJobPackets,
} from "@/api/generated/production/production";
import { AccessGuard } from "@/components/access-guard";
import { ActionSheet } from "@/components/action-sheet";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { integerInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { jobPacketsRoute } from "./job-packets";

const jobPacketSchema = z.object({
	packetNumber: z.string().min(1, m.job_packets_number_required()),
	productionOrderId: z.string().min(1, m.job_packets_production_required()),
	quantity: z.string().refine((value) => integerInput(value) > 0, {
		message: m.job_packets_quantity_required(),
	}),
});

const jobPacketColumns: ColumnDef<JobPacketResponse>[] = [
	{
		accessorKey: "packet_number",
		header: m.job_packets_number(),
		cell: ({ row }) => <span className="font-medium">{row.original.packet_number}</span>,
	},
	{
		accessorKey: "quantity",
		header: m.common_quantity(),
		cell: ({ row }) => formatNumberId(row.original.quantity),
	},
	{
		accessorKey: "status",
		header: m.common_status(),
	},
];

export function JobPacketsRouteScreen() {
	return (
		<AccessGuard
			anyOf={[
				"production.job_packets.read",
				"production.job_packets.create",
				"production.job_packets.assigned.read",
			]}
		>
			<JobPacketsScreen />
		</AccessGuard>
	);
}

function JobPacketsScreen() {
	const search = useSearch({ from: jobPacketsRoute.id });
	const navigate = useNavigate({ from: jobPacketsRoute.id });
	const capabilities = useBackendApiAuthGetCapabilities();
	const canManage = can(
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined,
		"production.job_packets.create",
	);
	const { data: response, isLoading, refetch } = useBackendApiProductionListJobPackets();
	const packets = response?.data;
	const createMutation = useBackendApiProductionCreateJobPacket();
	const isCreateOpen = canManage && search.action === "create";
	const openCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: "create" }) });
	};
	const closeCreate = () => {
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
	};
	const form = useForm({
		defaultValues: {
			packetNumber: "",
			productionOrderId: "",
			quantity: "10",
		},
		validators: {
			onChange: jobPacketSchema,
			onSubmit: jobPacketSchema,
		},
		onSubmit: async ({ value }) => {
			await createMutation.mutateAsync({
				data: {
					packet_number: value.packetNumber,
					production_order_id: value.productionOrderId,
					quantity: integerInput(value.quantity),
					current_stage_id: undefined,
				},
			});
			form.reset();
			await refetch();
			closeCreate();
		},
	});

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.job_packets_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.job_packets_description()}</p>
				</div>
				{canManage ? (
					<Button type="button" onClick={openCreate}>
						{m.job_packets_create_title()}
					</Button>
				) : null}
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle>{m.job_packets_list_title()}</CardTitle>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<DataLoading />
						) : packets?.length ? (
							<DataTable
								columns={jobPacketColumns}
								data={packets}
								getRowId={(packet) => packet.id}
							/>
						) : (
							<DataEmpty
								title={m.job_packets_empty_title()}
								description={m.job_packets_empty_description()}
							/>
						)}
					</CardContent>
				</Card>

				{canManage ? (
					<ActionSheet
						open={isCreateOpen}
						onOpenChange={(open) => {
							if (!open) closeCreate();
						}}
						title={m.job_packets_create_title()}
					>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void form.handleSubmit();
							}}
						>
							<FieldGroup className="gap-4">
								<form.Field name="packetNumber">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="job-packet-number">
													{m.job_packets_number()}
												</FieldLabel>
												<Input
													id="job-packet-number"
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
								<form.Field name="productionOrderId">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="job-production-order-id">
													{m.job_packets_production_id()}
												</FieldLabel>
												<Input
													id="job-production-order-id"
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
								<form.Field name="quantity">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="job-packet-quantity">{m.common_quantity()}</FieldLabel>
												<Input
													id="job-packet-quantity"
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
		</div>
	);
}
