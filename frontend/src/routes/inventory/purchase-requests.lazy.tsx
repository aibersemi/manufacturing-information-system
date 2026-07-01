import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	getBackendApiInventoryListPurchaseRequestsQueryKey,
	useBackendApiInventoryCreatePurchaseRequest,
	useBackendApiInventoryListPurchaseRequests,
	useBackendApiInventorySubmitPurchaseRequest,
} from "@/api/generated/inventory/inventory";
import { useBackendApiMasterdataListMaterials } from "@/api/generated/master-data/master-data";
import type { PurchaseRequestPayload } from "@/api/generated/models/purchaseRequestPayload";
import type { PurchaseRequestResponse } from "@/api/generated/models/purchaseRequestResponse";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
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
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { can } from "@/lib/capabilities";
import { decimalInput } from "@/lib/form-values";
import { formatNumberId } from "@/lib/i18n";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

export function PurchaseRequestsRouteScreen() {
	return (
		<AccessGuard anyOf={["inventory.purchase_requests.read"]}>
			<PurchaseRequestsScreen />
		</AccessGuard>
	);
}

const prDialogStore = new Store({ open: false });

const purchaseRequestFormSchema = z.object({
	materialId: z.string().trim().min(1, m.purchase_requests_material_required()),
	requestedQty: z
		.string()
		.trim()
		.min(1, m.purchase_requests_quantity_required())
		.refine(
			(value) => {
				const amount = decimalInput(value);
				return Number.isFinite(amount) && amount > 0;
			},
			{ message: m.purchase_requests_quantity_positive() },
		),
});

function toPurchaseRequestPayload(value: unknown): PurchaseRequestPayload {
	const parsed = purchaseRequestFormSchema.parse(value);
	return {
		material_id: parsed.materialId,
		requested_qty: decimalInput(parsed.requestedQty),
	};
}

function PurchaseRequestsScreen() {
	const queryClient = useQueryClient();
	const isOpen = useStore(prDialogStore, (state) => state.open);
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreate = can(capabilityList, "inventory.purchase_requests.create");
	const canSubmit = can(capabilityList, "inventory.purchase_requests.submit");

	const { data: prResponse, isLoading: isLoadingPR } = useBackendApiInventoryListPurchaseRequests();
	const prs = prResponse?.data || [];

	const { data: materialsResponse } = useBackendApiMasterdataListMaterials();
	const materials = materialsResponse?.data || [];

	const { mutateAsync: createPR } = useBackendApiInventoryCreatePurchaseRequest();
	const { mutateAsync: submitPR } = useBackendApiInventorySubmitPurchaseRequest();

	const form = useForm({
		defaultValues: {
			materialId: "",
			requestedQty: "",
		},
		validators: {
			onChange: purchaseRequestFormSchema,
			onSubmit: purchaseRequestFormSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				await createPR({ data: toPurchaseRequestPayload(value) });
				toast.success(m.purchase_requests_created_success());
				queryClient.invalidateQueries({
					queryKey: getBackendApiInventoryListPurchaseRequestsQueryKey(),
				});
				prDialogStore.setState((s) => ({ ...s, open: false }));
				form.reset();
			} catch (_error) {
				toast.error(m.common_mutation_error());
			}
		},
	});

	const handleSubmitPR = async (prId: string) => {
		try {
			await submitPR({ prId });
			toast.success(m.purchase_requests_submitted_success());
			queryClient.invalidateQueries({
				queryKey: getBackendApiInventoryListPurchaseRequestsQueryKey(),
			});
		} catch (_error) {
			toast.error(m.common_mutation_error());
		}
	};

	const columns: ColumnDef<PurchaseRequestResponse>[] = [
		{
			accessorKey: "pr_number",
			header: () => m.purchase_requests_number(),
			cell: ({ row }) => <span className="font-medium">{row.original.pr_number}</span>,
		},
		{
			accessorKey: "material_id",
			header: () => m.materials_name(),
			cell: ({ row }) => {
				const mat = materials.find((m) => m.id === row.original.material_id);
				return mat ? mat.name : row.original.material_id;
			},
		},
		{
			accessorKey: "requested_qty",
			header: () => m.common_quantity(),
			cell: ({ row }) => formatNumberId(row.original.requested_qty, { maximumFractionDigits: 4 }),
		},
		{
			accessorKey: "status",
			header: () => m.common_status(),
			cell: ({ row }) => {
				const status = row.original.status;
				return (
					<Badge
						variant={
							status === "draft" ? "secondary" : status === "ordered" ? "default" : "outline"
						}
					>
						{status.toUpperCase()}
					</Badge>
				);
			},
		},
		{
			id: "actions",
			header: () => m.common_action(),
			cell: ({ row }) => {
				if (canSubmit && row.original.status === "draft") {
					return (
						<Button
							size="sm"
							variant="outline"
							onClick={() => handleSubmitPR(row.original.id as string)}
						>
							{m.purchase_requests_submit()}
						</Button>
					);
				}
				return null;
			},
		},
	];

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.purchase_requests_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.purchase_requests_description()}</p>
				</div>
				{canCreate ? (
					<Sheet
						open={isOpen}
						onOpenChange={(v) => prDialogStore.setState((s) => ({ ...s, open: v }))}
					>
						<SheetTrigger asChild>
							<Button>
								<Plus className="mr-2 h-4 w-4" />
								{m.purchase_requests_create()}
							</Button>
						</SheetTrigger>
						<SheetContent>
							<SheetHeader>
								<SheetTitle>{m.purchase_requests_create_title()}</SheetTitle>
								<SheetDescription>{m.purchase_requests_create_description()}</SheetDescription>
							</SheetHeader>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									e.stopPropagation();
									form.handleSubmit();
								}}
								className="mt-6 flex flex-col gap-4"
							>
								<FieldGroup className="gap-4">
									<form.Field
										name="materialId"
										children={(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor={field.name}>{m.common_material()}</FieldLabel>
													<Select value={field.state.value} onValueChange={field.handleChange}>
														<SelectTrigger id={field.name}>
															<SelectValue placeholder={m.purchase_requests_select_material()} />
														</SelectTrigger>
														<SelectContent>
															{materials.map((mat) => (
																<SelectItem key={mat.id} value={mat.id as string}>
																	{mat.name}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									/>
									<form.Field
										name="requestedQty"
										children={(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor={field.name}>{m.common_quantity()}</FieldLabel>
													<Input
														id={field.name}
														type="text"
														inputMode="decimal"
														value={field.state.value}
														onChange={(e) => field.handleChange(e.target.value)}
														required
														aria-invalid={invalid}
													/>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									/>
									<form.Subscribe
										selector={(state) => [state.canSubmit, state.isSubmitting]}
										children={([canSubmit, isSubmitting]) => (
											<Button type="submit" disabled={!canSubmit || isSubmitting} className="mt-4">
												{isSubmitting ? m.common_saving() : m.purchase_requests_save()}
											</Button>
										)}
									/>
								</FieldGroup>
							</form>
						</SheetContent>
					</Sheet>
				) : null}
			</div>

			<div className="rounded-md border">
				{isLoadingPR ? (
					<DataLoading />
				) : prs.length ? (
					<DataTable columns={columns} data={prs} getRowId={(r) => r.id as string} />
				) : (
					<DataEmpty
						title={m.purchase_requests_empty_title()}
						description={m.purchase_requests_empty_description()}
					/>
				)}
			</div>
		</div>
	);
}
