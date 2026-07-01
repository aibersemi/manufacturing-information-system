import { useForm } from "@tanstack/react-form";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, MoreHorizontal, Plus, Search } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
	useBackendApiAdministrationActivateUser,
	useBackendApiAdministrationCreateUser,
	useBackendApiAdministrationDeactivateUser,
	useBackendApiAdministrationDeleteUser,
	useBackendApiAdministrationListTenants,
	useBackendApiAdministrationListUsers,
	useBackendApiAdministrationUpdateUser,
} from "@/api/generated/administration/administration";
import type { UserAdminResponse } from "@/api/generated/models/userAdminResponse";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

const schema = z.object({
	username: z.string().min(3),
	firstName: z.string().min(1),
	lastName: z.string(),
	email: z.string(),
	role: z.enum(["kepala_konveksi", "finance"]),
	tenantIds: z.array(z.number()).min(1),
	password: z.string(),
	confirmation: z.string(),
});
type UserFormValues = {
	username: string;
	firstName: string;
	lastName: string;
	email: string;
	role: "kepala_konveksi" | "finance";
	tenantIds: number[];
	password: string;
	confirmation: string;
};
const empty: UserFormValues = {
	username: "",
	firstName: "",
	lastName: "",
	email: "",
	role: "kepala_konveksi",
	tenantIds: [],
	password: "",
	confirmation: "",
};

export function UsersScreen() {
	return (
		<AccessGuard anyOf={["settings.users.read"]}>
			<UserDirectory />
		</AccessGuard>
	);
}

function UserDirectory() {
	const uiStore = useMemo(
		() =>
			new Store({
				page: 1,
				search: "",
				role: "",
				panelOpen: false,
				selected: null as UserAdminResponse | null,
				resetTarget: null as UserAdminResponse | null,
				action: null as null | { kind: "deactivate" | "delete"; item: UserAdminResponse },
			}),
		[],
	);
	const ui = useStore(uiStore);
	const { page, search, role, panelOpen, selected, resetTarget, action } = ui;
	const setUi = (patch: Partial<typeof ui>) =>
		uiStore.setState((state) => ({ ...state, ...patch }));
	const list = useBackendApiAdministrationListUsers({
		q: search || undefined,
		role: role || undefined,
		page,
		page_size: 20,
		sort: "username",
	});
	const tenantList = useBackendApiAdministrationListTenants({
		page: 1,
		page_size: 100,
		status: "active",
		sort: "name",
	});
	const data = list.data?.status === 200 ? list.data.data : undefined;
	const tenants = tenantList.data?.status === 200 ? tenantList.data.data.items : [];
	const createMutation = useBackendApiAdministrationCreateUser();
	const updateMutation = useBackendApiAdministrationUpdateUser();
	const activateMutation = useBackendApiAdministrationActivateUser();
	const deactivateMutation = useBackendApiAdministrationDeactivateUser();
	const deleteMutation = useBackendApiAdministrationDeleteUser();
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
					role: value.role,
					tenant_ids: value.tenantIds,
				};
				if (selected) await updateMutation.mutateAsync({ userId: selected.id, data: base });
				else {
					if (value.password !== value.confirmation) {
						toast.error(m.password_mismatch());
						return;
					}
					await createMutation.mutateAsync({
						data: { ...base, password: value.password, password_confirmation: value.confirmation },
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
						role: selected.role === "finance" ? "finance" : "kepala_konveksi",
						tenantIds: selected.memberships.map((item) => item.tenant_id),
						password: "",
						confirmation: "",
					}
				: empty,
		);
	}, [selected, form]);
	const openEdit = (item: UserAdminResponse) => {
		if (!item.editable) return;
		setUi({ selected: item, panelOpen: true });
	};
	const toggle = async (item: UserAdminResponse) => {
		if (item.is_active) {
			setUi({ action: { kind: "deactivate", item } });
			return;
		}
		try {
			await activateMutation.mutateAsync({
				userId: item.id,
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
					userId: action.item.id,
					data: { reason: payload.reason },
				});
			else
				await deleteMutation.mutateAsync({
					userId: action.item.id,
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
	const columns = useMemo<ColumnDef<UserAdminResponse>[]>(
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
				accessorKey: "role",
				header: m.common_role(),
				cell: ({ row }) => <Badge variant="outline">{roleLabel(row.original.role)}</Badge>,
			},
			{
				id: "memberships",
				header: m.common_membership(),
				cell: ({ row }) => row.original.memberships.map((item) => item.tenant_name).join(", "),
			},
			{
				accessorKey: "is_active",
				header: m.common_status(),
				cell: ({ row }) => (
					<Badge variant={row.original.is_active ? "secondary" : "outline"}>
						{row.original.is_active ? m.common_active() : m.common_inactive()}
					</Badge>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<UserActions
						user={row.original}
						onEdit={() => openEdit(row.original)}
						onToggle={() => void toggle(row.original)}
						onReset={() => setUi({ resetTarget: row.original })}
						onDelete={() => setUi({ action: { kind: "delete", item: row.original } })}
					/>
				),
			},
		],
		[],
	);
	return (
		<div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.settings_users_title()}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{m.settings_users_description()}</p>
				</div>
				<Button onClick={() => setUi({ selected: null, panelOpen: true })}>
					<Plus />
					{m.settings_users_add()}
				</Button>
			</div>
			<div className="flex flex-col gap-3 sm:flex-row">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
					<Input
						className="pl-9"
						value={search}
						onChange={(e) => setUi({ search: e.target.value, page: 1 })}
						placeholder={m.settings_users_search()}
					/>
				</div>
				<NativeSelect
					value={role}
					onChange={(e) => setUi({ role: e.target.value, page: 1 })}
					aria-label={m.common_role()}
				>
					<NativeSelectOption value="">{m.common_role()}</NativeSelectOption>
					<NativeSelectOption value="kepala_konveksi">
						{m.settings_user_role_head()}
					</NativeSelectOption>
					<NativeSelectOption value="finance">{m.settings_user_role_finance()}</NativeSelectOption>
				</NativeSelect>
			</div>
			<Card className="overflow-hidden">
				<CardContent className="p-0">
					{list.isLoading ? (
						<DataLoading />
					) : !data?.items.length ? (
						<DataEmpty
							title={m.settings_users_empty()}
							description={m.settings_users_description()}
						/>
					) : (
						<>
							<div className="hidden md:block">
								<DataTable
									columns={columns}
									data={data.items}
									getRowId={(item) => String(item.id)}
								/>
							</div>
							<div className="divide-y md:hidden">
								{data.items.map((user) => (
									<div key={user.id} className="flex items-start justify-between p-4">
										<div>
											<p className="font-medium">{user.full_name}</p>
											<p className="text-sm text-muted-foreground">
												@{user.username} · {roleLabel(user.role)}
											</p>
											<p className="mt-1 text-xs text-muted-foreground">
												{user.memberships.map((item) => item.tenant_name).join(", ")}
											</p>
											{user.managed_by_server ? (
												<Badge className="mt-2" variant="outline">
													{m.settings_user_server_managed()}
												</Badge>
											) : null}
										</div>
										<UserActions
											user={user}
											onEdit={() => openEdit(user)}
											onToggle={() => void toggle(user)}
											onReset={() => setUi({ resetTarget: user })}
											onDelete={() => setUi({ action: { kind: "delete", item: user } })}
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
				title={selected ? m.settings_user_edit_title() : m.settings_user_create_title()}
				description={m.settings_users_description()}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<FieldGroup>
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
										<FieldLabel htmlFor={`user-${name}`}>{label}</FieldLabel>
										<Input
											id={`user-${name}`}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
										<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
									</Field>
								)}
							</form.Field>
						))}
						<form.Field name="role">
							{(field) => (
								<Field>
									<FieldLabel>{m.common_role()}</FieldLabel>
									<NativeSelect
										value={field.state.value}
										onChange={(e) =>
											field.handleChange(e.target.value as "finance" | "kepala_konveksi")
										}
									>
										<NativeSelectOption value="kepala_konveksi">
											{m.settings_user_role_head()}
										</NativeSelectOption>
										<NativeSelectOption value="finance">
											{m.settings_user_role_finance()}
										</NativeSelectOption>
									</NativeSelect>
								</Field>
							)}
						</form.Field>
						<form.Field name="tenantIds">
							{(field) => (
								<Field>
									<FieldLabel>{m.settings_user_tenants()}</FieldLabel>
									<div className="grid gap-3 rounded-md border p-3">
										{tenants.map((tenant) => (
											<Label key={tenant.id} className="font-normal">
												<Checkbox
													checked={field.state.value.includes(tenant.id)}
													onCheckedChange={(checked) =>
														field.handleChange(
															checked
																? [...field.state.value, tenant.id]
																: field.state.value.filter((id) => id !== tenant.id),
														)
													}
												/>
												{tenant.name}
											</Label>
										))}
									</div>
									<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
								</Field>
							)}
						</form.Field>
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
												<FieldLabel htmlFor={`user-${name}`}>{label}</FieldLabel>
												<Input
													id={`user-${name}`}
													type="password"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
												/>
											</Field>
										)}
									</form.Field>
								))
							: null}
						<Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
							{createMutation.isPending || updateMutation.isPending ? <Spinner /> : null}
							{m.common_save()}
						</Button>
					</FieldGroup>
				</form>
			</ResponsivePanel>
			<ResetPasswordDialog
				userId={resetTarget?.id ?? null}
				username={resetTarget?.username ?? ""}
				open={Boolean(resetTarget)}
				onOpenChange={(open) => {
					if (!open) setUi({ resetTarget: null });
				}}
			/>
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

function roleLabel(role: string) {
	return role === "super_admin"
		? "Super Admin"
		: role === "finance"
			? m.settings_user_role_finance()
			: m.settings_user_role_head();
}
function UserActions({
	user,
	onEdit,
	onToggle,
	onReset,
	onDelete,
}: {
	user: UserAdminResponse;
	onEdit: () => void;
	onToggle: () => void;
	onReset: () => void;
	onDelete: () => void;
}) {
	return (
		<DropdownMenu>
			<Button variant="ghost" size="icon" asChild>
				<DropdownMenuTrigger aria-label={m.common_more_actions()}>
					<MoreHorizontal />
				</DropdownMenuTrigger>
			</Button>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					{user.editable ? (
						<DropdownMenuItem onSelect={onEdit}>{m.common_edit()}</DropdownMenuItem>
					) : null}
					{!user.managed_by_server ? (
						<DropdownMenuItem onSelect={onToggle}>
							{user.is_active ? m.common_deactivate() : m.common_activate()}
						</DropdownMenuItem>
					) : null}
					{!user.managed_by_server ? (
						<DropdownMenuItem onSelect={onReset}>
							<KeyRound />
							{m.settings_user_reset_password()}
						</DropdownMenuItem>
					) : null}
					{!user.managed_by_server ? (
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
