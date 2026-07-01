import { useForm } from "@tanstack/react-form";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	useBackendApiAdministrationActivateOperatorAccount,
	useBackendApiAdministrationCreateAdminOperator,
	useBackendApiAdministrationDeactivateOperatorAccount,
	useBackendApiAdministrationDeleteAdminOperator,
	useBackendApiAdministrationListAdminOperators,
	useBackendApiAdministrationUpdateAdminOperator,
} from "@/api/generated/administration/administration";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import type { OperatorAdminResponse } from "@/api/generated/models/operatorAdminResponse";
import { AccessGuard } from "@/components/access-guard";
import { AdminPagination } from "@/components/admin-pagination";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { LifecycleActionDialog } from "@/components/lifecycle-action-dialog";
import { ResetPasswordDialog } from "@/components/password-dialogs";
import { ResponsivePanel } from "@/components/responsive-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { can } from "@/lib/capabilities";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

const operatorTypes = [
	"mandor",
	"penjahit",
	"potong",
	"sablon",
	"qc",
	"packing",
	"gudang",
	"pembelian",
	"dapur",
	"maklon",
] as const;
const empty = {
	username: "",
	firstName: "",
	lastName: "",
	email: "",
	password: "",
	confirmation: "",
	operatorType: "penjahit",
	status: "internal",
	supervisorId: "",
	location: "",
	phone: "",
	workActive: true,
};
const schema = z.object({
	username: z.string().min(3),
	firstName: z.string().min(1),
	lastName: z.string(),
	email: z.string(),
	password: z.string(),
	confirmation: z.string(),
	operatorType: z.string(),
	status: z.string(),
	supervisorId: z.string(),
	location: z.string(),
	phone: z.string(),
	workActive: z.boolean(),
});

export function OperatorsScreen() {
	return (
		<AccessGuard anyOf={["settings.operators.read"]}>
			<OperatorDirectory />
		</AccessGuard>
	);
}
function OperatorDirectory() {
	const capabilities = useBackendApiAuthGetCapabilities();
	const actor = capabilities.data?.status === 200 ? capabilities.data.data : undefined;
	const canCreate = can(actor?.capabilities, "settings.operators.create");
	const canUpdate = can(actor?.capabilities, "settings.operators.update");
	const canActivate = can(actor?.capabilities, "settings.operators.activate");
	const canDeactivate = can(actor?.capabilities, "settings.operators.deactivate");
	const canDelete = can(actor?.capabilities, "settings.operators.delete");
	const canResetPassword = can(actor?.capabilities, "settings.operators.reset_password");
	const uiStore = useMemo(
		() =>
			new Store({
				page: 1,
				search: "",
				type: "",
				panelOpen: false,
				selected: null as OperatorAdminResponse | null,
				resetTarget: null as OperatorAdminResponse | null,
				action: null as null | { kind: "deactivate" | "delete"; item: OperatorAdminResponse },
			}),
		[],
	);
	const ui = useStore(uiStore);
	const { page, search, type, panelOpen, selected, resetTarget, action } = ui;
	const setUi = (patch: Partial<typeof ui>) =>
		uiStore.setState((state) => ({ ...state, ...patch }));
	const list = useBackendApiAdministrationListAdminOperators({
		q: search || undefined,
		operator_type: type || undefined,
		page,
		page_size: 20,
		sort: "username",
	});
	const data = list.data?.status === 200 ? list.data.data : undefined;
	const supervisors =
		data?.items.filter((item) => item.operator_type === "mandor" && item.id !== selected?.id) ?? [];
	const createMutation = useBackendApiAdministrationCreateAdminOperator();
	const updateMutation = useBackendApiAdministrationUpdateAdminOperator();
	const activateMutation = useBackendApiAdministrationActivateOperatorAccount();
	const deactivateMutation = useBackendApiAdministrationDeactivateOperatorAccount();
	const deleteMutation = useBackendApiAdministrationDeleteAdminOperator();
	const form = useForm({
		defaultValues: empty,
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			try {
				const base = {
					username: value.username,
					first_name: value.firstName,
					last_name: value.lastName,
					email: value.email,
					operator_type: value.operatorType,
					status: value.status,
					supervisor_id: value.supervisorId || null,
					location: value.location,
					phone: value.phone,
					work_is_active: value.workActive,
				};
				if (selected) await updateMutation.mutateAsync({ operatorId: selected.id, data: base });
				else {
					if (value.password !== value.confirmation) {
						toast.error(m.password_mismatch());
						return;
					}
					await createMutation.mutateAsync({
						data: {
							...base,
							password: value.password,
							password_confirmation: value.confirmation,
							account_is_active: true,
						},
					});
				}
				toast.success(m.common_mutation_success());
				setUi({ panelOpen: false });
				await list.refetch();
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});
	useEffect(() => {
		form.reset(
			selected
				? {
						username: selected.username,
						firstName: selected.first_name,
						lastName: selected.last_name,
						email: selected.email,
						password: "",
						confirmation: "",
						operatorType: selected.operator_type,
						status: selected.status,
						supervisorId: selected.supervisor_id ?? "",
						location: selected.location,
						phone: selected.phone,
						workActive: selected.work_is_active,
					}
				: empty,
		);
	}, [selected, form]);
	const openEdit = (item: OperatorAdminResponse) => setUi({ selected: item, panelOpen: true });
	const toggle = async (item: OperatorAdminResponse) => {
		if (item.account_is_active) {
			setUi({ action: { kind: "deactivate", item } });
			return;
		}
		try {
			await activateMutation.mutateAsync({
				operatorId: item.id,
				data: { reason: m.common_activate() },
			});
			toast.success(m.common_mutation_success());
			await list.refetch();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	};
	const confirmLifecycle = async (payload: {
		reason: string;
		confirmation: string;
		actorPassword: string;
	}) => {
		if (!action) return;
		try {
			if (action.kind === "deactivate")
				await deactivateMutation.mutateAsync({
					operatorId: action.item.id,
					data: { reason: payload.reason },
				});
			else
				await deleteMutation.mutateAsync({
					operatorId: action.item.id,
					data: {
						reason: payload.reason,
						confirmation: payload.confirmation,
						actor_password: payload.actorPassword,
					},
				});
			toast.success(m.common_mutation_success());
			setUi({ action: null });
			await list.refetch();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	};
	const columns = useMemo<ColumnDef<OperatorAdminResponse>[]>(
		() => [
			{
				accessorKey: "full_name",
				header: m.common_user(),
				cell: ({ row }) => (
					<div>
						<p className="font-medium">{row.original.full_name}</p>
						<p className="text-xs text-muted-foreground">@{row.original.username}</p>
					</div>
				),
			},
			{
				accessorKey: "operator_type",
				header: m.common_type(),
				cell: ({ row }) => operatorTypeLabel(row.original.operator_type),
			},
			{
				accessorKey: "supervisor_name",
				header: m.common_supervisor(),
				cell: ({ row }) => row.original.supervisor_name || "—",
			},
			{
				id: "status",
				header: m.common_status(),
				cell: ({ row }) => (
					<div className="flex gap-2">
						<Badge variant={row.original.account_is_active ? "secondary" : "outline"}>
							{row.original.account_is_active ? m.common_active() : m.common_inactive()}
						</Badge>
						<Badge variant="outline">
							{row.original.status === "internal"
								? m.settings_operator_internal()
								: m.settings_operator_external()}
						</Badge>
					</div>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<OperatorActions
						item={row.original}
						canActivate={canActivate}
						canDeactivate={canDeactivate}
						canDelete={canDelete}
						canResetPassword={canResetPassword}
						canUpdate={canUpdate}
						onEdit={() => openEdit(row.original)}
						onToggle={() => void toggle(row.original)}
						onReset={() => setUi({ resetTarget: row.original })}
						onDelete={() => setUi({ action: { kind: "delete", item: row.original } })}
					/>
				),
			},
		],
		[canActivate, canDeactivate, canDelete, canResetPassword, canUpdate],
	);
	return (
		<div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.settings_operators_title()}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{m.settings_operators_description()}</p>
					<Badge className="mt-3" variant="outline">
						{m.settings_operators_active_tenant({ tenant: actor?.tenant.name ?? "" })}
					</Badge>
				</div>
				{canCreate ? (
					<Button onClick={() => setUi({ selected: null, panelOpen: true })}>
						<Plus />
						{m.settings_operators_add()}
					</Button>
				) : null}
			</div>
			<div className="flex flex-col gap-3 sm:flex-row">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
					<Input
						className="pl-9"
						value={search}
						onChange={(e) => setUi({ search: e.target.value, page: 1 })}
						placeholder={m.settings_operators_search()}
					/>
				</div>
				<NativeSelect
					value={type}
					onChange={(e) => setUi({ type: e.target.value, page: 1 })}
					aria-label={m.settings_operator_type()}
				>
					<NativeSelectOption value="">{m.settings_operator_type()}</NativeSelectOption>
					{operatorTypes.map((item) => (
						<NativeSelectOption key={item} value={item}>
							{operatorTypeLabel(item)}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>
			<Card className="overflow-hidden">
				<CardContent className="p-0">
					{list.isLoading ? (
						<DataLoading />
					) : !data?.items.length ? (
						<DataEmpty
							title={m.settings_operators_empty()}
							description={m.settings_operators_description()}
						/>
					) : (
						<>
							<div className="hidden md:block">
								<DataTable columns={columns} data={data.items} getRowId={(item) => item.id} />
							</div>
							<div className="divide-y md:hidden">
								{data.items.map((item) => (
									<div key={item.id} className="flex items-start justify-between gap-3 p-4">
										<div>
											<p className="font-medium">{item.full_name}</p>
											<p className="text-sm text-muted-foreground">
												@{item.username} · {operatorTypeLabel(item.operator_type)}
											</p>
											<div className="mt-2 flex gap-2">
												<Badge variant={item.account_is_active ? "secondary" : "outline"}>
													{item.account_is_active ? m.common_active() : m.common_inactive()}
												</Badge>
												<Badge variant="outline">
													{item.status === "internal"
														? m.settings_operator_internal()
														: m.settings_operator_external()}
												</Badge>
											</div>
										</div>
										<OperatorActions
											item={item}
											canActivate={canActivate}
											canDeactivate={canDeactivate}
											canDelete={canDelete}
											canResetPassword={canResetPassword}
											canUpdate={canUpdate}
											onEdit={() => openEdit(item)}
											onToggle={() => void toggle(item)}
											onReset={() => setUi({ resetTarget: item })}
											onDelete={() => setUi({ action: { kind: "delete", item } })}
										/>
									</div>
								))}
							</div>
							<AdminPagination
								page={data.page}
								pageSize={data.page_size}
								total={data.total}
								totalPages={data.total_pages}
								onPageChange={(nextPage) => setUi({ page: nextPage })}
							/>
						</>
					)}
				</CardContent>
			</Card>
			<ResponsivePanel
				open={panelOpen}
				onOpenChange={(open) => setUi({ panelOpen: open })}
				title={selected ? m.settings_operator_edit_title() : m.settings_operator_create_title()}
				description={m.settings_operators_description()}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<FieldGroup>
						<p className="text-sm font-semibold">{m.settings_operator_login_section()}</p>
						{(
							[
								["username", m.common_username()],
								["firstName", m.common_first_name()],
								["lastName", m.common_last_name()],
								["email", m.common_email()],
							] as const
						).map(([name, label]) => (
							<form.Field key={name} name={name}>
								{(field) => (
									<Field>
										<FieldLabel>{label}</FieldLabel>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
										<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
									</Field>
								)}
							</form.Field>
						))}
						{!selected
							? (
									[
										["password", m.login_password_label()],
										["confirmation", m.password_confirmation()],
									] as const
								).map(([name, label]) => (
									<form.Field key={name} name={name}>
										{(field) => (
											<Field>
												<FieldLabel>{label}</FieldLabel>
												<Input
													type="password"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</Field>
										)}
									</form.Field>
								))
							: null}
						<p className="pt-2 text-sm font-semibold">{m.settings_operator_profile_section()}</p>
						<form.Field name="operatorType">
							{(field) => (
								<Field>
									<FieldLabel>{m.settings_operator_type()}</FieldLabel>
									<NativeSelect
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									>
										{operatorTypes.map((item) => (
											<NativeSelectOption key={item} value={item}>
												{operatorTypeLabel(item)}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="status">
							{(field) => (
								<Field>
									<FieldLabel>{m.settings_operator_status()}</FieldLabel>
									<NativeSelect
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									>
										<NativeSelectOption value="internal">
											{m.settings_operator_internal()}
										</NativeSelectOption>
										<NativeSelectOption value="external">
											{m.settings_operator_external()}
										</NativeSelectOption>
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="supervisorId">
							{(field) => (
								<Field>
									<FieldLabel>{m.common_supervisor()}</FieldLabel>
									<NativeSelect
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									>
										<NativeSelectOption value="">
											{m.settings_operator_optional()}
										</NativeSelectOption>
										{supervisors.map((item) => (
											<NativeSelectOption key={item.id} value={item.id}>
												{item.full_name}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						{(
							[
								["location", m.common_location()],
								["phone", m.common_phone()],
							] as const
						).map(([name, label]) => (
							<form.Field key={name} name={name}>
								{(field) => (
									<Field>
										<FieldLabel>{label}</FieldLabel>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</Field>
								)}
							</form.Field>
						))}
						<Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
							{createMutation.isPending || updateMutation.isPending ? <Spinner /> : null}
							{m.common_save()}
						</Button>
					</FieldGroup>
				</form>
			</ResponsivePanel>
			{canResetPassword ? (
				<ResetPasswordDialog
					userId={resetTarget?.user_id ?? null}
					username={resetTarget?.username ?? ""}
					open={Boolean(resetTarget)}
					onOpenChange={(open) => {
						if (!open) setUi({ resetTarget: null });
					}}
				/>
			) : null}
			<LifecycleActionDialog
				open={Boolean(action)}
				action={action?.kind ?? "deactivate"}
				targetLabel={action?.item.username ?? ""}
				confirmationValue={action?.item.username ?? ""}
				blockers={action?.kind === "delete" ? action.item.deletion_eligibility.blockers : []}
				pending={deactivateMutation.isPending || deleteMutation.isPending}
				onOpenChange={(open) => {
					if (!open) setUi({ action: null });
				}}
				onConfirm={confirmLifecycle}
			/>
		</div>
	);
}

function operatorTypeLabel(type: string) {
	const labels = new Map<string, () => string>([
		["mandor", m.settings_operator_type_mandor],
		["penjahit", m.settings_operator_type_penjahit],
		["potong", m.settings_operator_type_potong],
		["sablon", m.settings_operator_type_sablon],
		["qc", m.settings_operator_type_qc],
		["packing", m.settings_operator_type_packing],
		["gudang", m.settings_operator_type_gudang],
		["pembelian", m.settings_operator_type_pembelian],
		["dapur", m.settings_operator_type_dapur],
		["maklon", m.settings_operator_type_maklon],
	]);
	return labels.get(type)?.() ?? type;
}
function OperatorActions({
	item,
	canActivate,
	canDeactivate,
	canDelete,
	canResetPassword,
	canUpdate,
	onEdit,
	onToggle,
	onReset,
	onDelete,
}: {
	item: OperatorAdminResponse;
	canActivate: boolean;
	canDeactivate: boolean;
	canDelete: boolean;
	canResetPassword: boolean;
	canUpdate: boolean;
	onEdit: () => void;
	onToggle: () => void;
	onReset: () => void;
	onDelete: () => void;
}) {
	const canToggle = item.account_is_active ? canDeactivate : canActivate;
	if (!canUpdate && !canToggle && !canResetPassword && !canDelete) {
		return null;
	}
	return (
		<DropdownMenu>
			<Button variant="ghost" size="icon" asChild>
				<DropdownMenuTrigger aria-label={m.common_more_actions()}>
					<MoreHorizontal />
				</DropdownMenuTrigger>
			</Button>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					{canUpdate ? (
						<DropdownMenuItem onSelect={onEdit}>{m.common_edit()}</DropdownMenuItem>
					) : null}
					{canToggle ? (
						<DropdownMenuItem onSelect={onToggle}>
							{item.account_is_active ? m.common_deactivate() : m.common_activate()}
						</DropdownMenuItem>
					) : null}
					{canResetPassword ? (
						<DropdownMenuItem onSelect={onReset}>
							{m.settings_user_reset_password()}
						</DropdownMenuItem>
					) : null}
					{canDelete ? (
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={onDelete}
						>
							{m.common_delete()}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
