import { useForm } from "@tanstack/react-form";
import { Store, useStore } from "@tanstack/react-store";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
	useBackendApiAdministrationActivateTenant,
	useBackendApiAdministrationCreateTenant,
	useBackendApiAdministrationDeactivateTenant,
	useBackendApiAdministrationDeleteTenant,
	useBackendApiAdministrationListTenants,
	useBackendApiAdministrationUpdateTenant,
} from "@/api/generated/administration/administration";
import type { TenantAdminResponse } from "@/api/generated/models/tenantAdminResponse";
import { AccessGuard } from "@/components/access-guard";
import { AdminPagination } from "@/components/admin-pagination";
import { DataEmpty, DataLoading } from "@/components/data-states";
import { DataTable } from "@/components/data-table";
import { LifecycleActionDialog } from "@/components/lifecycle-action-dialog";
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
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

const schema = z.object({
	name: z.string().min(2),
	slug: z.string(),
	code: z.string().min(1).max(12),
	address: z.string(),
	phone: z.string(),
});

export function TenantsScreen() {
	return (
		<AccessGuard anyOf={["settings.tenants.read"]}>
			<TenantDirectory />
		</AccessGuard>
	);
}

function TenantDirectory() {
	const uiStore = useMemo(
		() =>
			new Store({
				page: 1,
				search: "",
				status: "",
				panelOpen: false,
				selected: null as TenantAdminResponse | null,
				action: null as null | { kind: "deactivate" | "delete"; item: TenantAdminResponse },
			}),
		[],
	);
	const ui = useStore(uiStore);
	const { page, search, status, panelOpen, selected, action } = ui;
	const setUi = (patch: Partial<typeof ui>) =>
		uiStore.setState((state) => ({ ...state, ...patch }));
	const list = useBackendApiAdministrationListTenants({
		page,
		page_size: 20,
		q: search || undefined,
		status: status || undefined,
		sort: "name",
	});
	const payload = list.data?.status === 200 ? list.data.data : undefined;
	const createMutation = useBackendApiAdministrationCreateTenant();
	const updateMutation = useBackendApiAdministrationUpdateTenant();
	const activateMutation = useBackendApiAdministrationActivateTenant();
	const deactivateMutation = useBackendApiAdministrationDeactivateTenant();
	const deleteMutation = useBackendApiAdministrationDeleteTenant();
	const refresh = async () => {
		await list.refetch();
	};
	const form = useForm({
		defaultValues: { name: "", slug: "", code: "", address: "", phone: "" },
		validators: { onSubmit: schema },
		onSubmit: async ({ value }) => {
			try {
				if (selected)
					await updateMutation.mutateAsync({
						tenantId: selected.id,
						data: {
							name: value.name,
							code: value.code,
							address: value.address,
							phone: value.phone,
						},
					});
				else await createMutation.mutateAsync({ data: value });
				toast.success(m.common_mutation_success());
				setUi({ panelOpen: false });
				form.reset();
				await refresh();
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});
	useEffect(() => {
		form.reset(
			selected
				? {
						name: selected.name,
						slug: selected.slug,
						code: selected.code,
						address: selected.address,
						phone: selected.phone,
					}
				: { name: "", slug: "", code: "", address: "", phone: "" },
		);
	}, [selected, form]);
	const openCreate = () => setUi({ selected: null, panelOpen: true });
	const openEdit = (tenant: TenantAdminResponse) => setUi({ selected: tenant, panelOpen: true });
	const toggle = async (tenant: TenantAdminResponse) => {
		if (tenant.is_active) {
			setUi({ action: { kind: "deactivate", item: tenant } });
			return;
		}
		try {
			await activateMutation.mutateAsync({
				tenantId: tenant.id,
				data: { reason: m.common_activate() },
			});
			toast.success(m.common_mutation_success());
			await refresh();
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
					tenantId: action.item.id,
					data: { reason: payload.reason },
				});
			else
				await deleteMutation.mutateAsync({
					tenantId: action.item.id,
					data: {
						reason: payload.reason,
						confirmation: payload.confirmation,
						actor_password: payload.actorPassword,
					},
				});
			toast.success(m.common_mutation_success());
			setUi({ action: null });
			await refresh();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	};
	const columns = useMemo<ColumnDef<TenantAdminResponse>[]>(
		() => [
			{
				accessorKey: "name",
				header: m.settings_tenant_name(),
				cell: ({ row }) => (
					<div>
						<p className="font-medium">{row.original.name}</p>
						<p className="text-xs text-muted-foreground">{row.original.slug}</p>
					</div>
				),
			},
			{ accessorKey: "code", header: m.settings_tenant_code() },
			{ accessorKey: "user_count", header: m.common_users() },
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
					<Actions
						onEdit={() => openEdit(row.original)}
						onToggle={() => void toggle(row.original)}
						active={row.original.is_active}
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
					<h1 className="text-2xl font-bold">{m.settings_tenants_title()}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{m.settings_tenants_description()}</p>
				</div>
				<Button onClick={openCreate}>
					<Plus />
					{m.settings_tenants_add()}
				</Button>
			</div>
			<div className="flex flex-col gap-3 sm:flex-row">
				<div className="relative flex-1">
					<Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
					<Input
						className="pl-9"
						value={search}
						onChange={(e) => setUi({ search: e.target.value, page: 1 })}
						placeholder={m.settings_tenants_search()}
					/>
				</div>
				<NativeSelect
					value={status}
					onChange={(e) => setUi({ status: e.target.value, page: 1 })}
					aria-label={m.common_filter_status()}
				>
					<NativeSelectOption value="">{m.common_filter_status()}</NativeSelectOption>
					<NativeSelectOption value="active">{m.common_active()}</NativeSelectOption>
					<NativeSelectOption value="inactive">{m.common_inactive()}</NativeSelectOption>
				</NativeSelect>
			</div>
			<Card className="overflow-hidden">
				<CardContent className="p-0">
					{list.isLoading ? (
						<DataLoading />
					) : !payload?.items.length ? (
						<DataEmpty
							title={m.settings_tenants_empty()}
							description={m.settings_tenants_description()}
						/>
					) : (
						<>
							<div className="hidden md:block">
								<DataTable
									columns={columns}
									data={payload.items}
									getRowId={(item) => String(item.id)}
								/>
							</div>
							<div className="divide-y md:hidden">
								{payload.items.map((tenant) => (
									<div key={tenant.id} className="flex items-start justify-between gap-3 p-4">
										<div>
											<p className="font-medium">{tenant.name}</p>
											<p className="text-sm text-muted-foreground">
												{tenant.code} · {tenant.user_count} {m.common_users()}
											</p>
											<Badge className="mt-2" variant={tenant.is_active ? "secondary" : "outline"}>
												{tenant.is_active ? m.common_active() : m.common_inactive()}
											</Badge>
										</div>
										<Actions
											onEdit={() => openEdit(tenant)}
											onToggle={() => void toggle(tenant)}
											active={tenant.is_active}
											onDelete={() => setUi({ action: { kind: "delete", item: tenant } })}
										/>
									</div>
								))}
							</div>
							<AdminPagination
								page={payload.page}
								pageSize={payload.page_size}
								total={payload.total}
								totalPages={payload.total_pages}
								onPageChange={(nextPage) => setUi({ page: nextPage })}
							/>
						</>
					)}
				</CardContent>
			</Card>
			<ResponsivePanel
				open={panelOpen}
				onOpenChange={(open) => setUi({ panelOpen: open })}
				title={selected ? m.settings_tenant_edit_title() : m.settings_tenant_create_title()}
				description={m.settings_tenants_description()}
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
								["name", m.settings_tenant_name()],
								["slug", m.settings_tenant_slug()],
								["code", m.settings_tenant_code()],
								["address", m.settings_tenant_address()],
								["phone", m.common_phone()],
							] as const
						).map(([name, label]) => (
							<form.Field key={name} name={name}>
								{(field) => (
									<Field>
										<FieldLabel htmlFor={`tenant-${name}`}>{label}</FieldLabel>
										<Input
											id={`tenant-${name}`}
											value={field.state.value}
											disabled={name === "slug" && Boolean(selected)}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
										<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
									</Field>
								)}
							</form.Field>
						))}
						{selected ? (
							<p className="text-xs text-muted-foreground">{m.settings_tenant_slug_readonly()}</p>
						) : null}
						<Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
							{createMutation.isPending || updateMutation.isPending ? <Spinner /> : null}
							{m.common_save()}
						</Button>
					</FieldGroup>
				</form>
			</ResponsivePanel>
			<LifecycleActionDialog
				open={Boolean(action)}
				action={action?.kind ?? "deactivate"}
				targetLabel={action?.item.name ?? ""}
				confirmationValue={action?.item.name ?? ""}
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

function Actions({
	onEdit,
	onToggle,
	onDelete,
	active,
}: {
	onEdit: () => void;
	onToggle: () => void;
	onDelete: () => void;
	active: boolean;
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
					<DropdownMenuItem onSelect={onEdit}>{m.common_edit()}</DropdownMenuItem>
					<DropdownMenuItem onSelect={onToggle}>
						{active ? m.common_deactivate() : m.common_activate()}
					</DropdownMenuItem>
					<DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
						{m.common_delete()}
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
