import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import type { LucideIcon } from "lucide-react";
import {
	Banknote,
	BookOpen,
	BriefcaseBusiness,
	Building2,
	Calculator,
	ChevronDown,
	Coins,
	Database,
	Factory,
	FileChartColumn,
	Home,
	KeyRound,
	LogOut,
	Package,
	Settings,
	ShieldCheck,
	ShoppingCart,
	UserRound,
	Users,
	Warehouse,
} from "lucide-react";
import { useEffect, useMemo } from "react";

import {
	useBackendApiAuthApiLogout,
	useBackendApiAuthGetAvailableTenants,
	useBackendApiAuthGetCapabilities,
	useBackendApiAuthSwitchTenant,
} from "@/api/generated/auth/auth";
import { ChangePasswordDialog } from "@/components/password-dialogs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { can } from "@/lib/capabilities";
import { buildNavigation, type NavGroupKey, type NavItemKey } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";
import { queryClient } from "./root";

const COLLAPSED_NAV_GROUPS_STORAGE_KEY = "mis.sidebar.collapsed-groups.v1";

const GROUP_LABELS = new Map<NavGroupKey, () => string>([
	["main", m.nav_group_main],
	["masterdata", m.nav_group_master_data],
	["sales", m.nav_group_sales],
	["production", m.nav_group_production],
	["inventory", m.nav_group_inventory],
	["labor", m.nav_group_labor],
	["finance", m.nav_group_finance],
	["accounting", m.nav_group_accounting],
	["reports", m.nav_group_reports],
	["control", m.nav_group_control],
	["settings", m.nav_group_settings],
]);

const ITEM_META = new Map<NavItemKey, { title: () => string; icon: LucideIcon }>([
	["home", { title: m.nav_home, icon: Home }],
	["customers", { title: m.nav_customers, icon: Users }],
	["suppliers", { title: m.nav_suppliers, icon: BriefcaseBusiness }],
	["materials", { title: m.nav_materials, icon: Database }],
	["products", { title: m.nav_product_models, icon: Package }],
	["boms", { title: m.nav_boms, icon: Database }],
	["routings", { title: m.nav_routings, icon: Factory }],
	["piece_rates", { title: m.nav_piece_rates, icon: Banknote }],
	["chart_of_accounts", { title: m.nav_chart_of_accounts, icon: BookOpen }],
	["bank_accounts", { title: m.nav_bank_accounts, icon: Coins }],
	["cost_categories", { title: m.nav_cost_categories, icon: Calculator }],
	["sales_orders", { title: m.nav_sales_po, icon: ShoppingCart }],
	["production_orders", { title: m.nav_production_orders, icon: Factory }],
	["job_packets", { title: m.nav_job_packets, icon: Package }],
	["production_progress", { title: m.nav_production_progress, icon: Factory }],
	["progress_verification", { title: m.nav_progress_verification, icon: ShieldCheck }],
	["qc", { title: m.nav_qc, icon: ShieldCheck }],
	["rework", { title: m.nav_rework, icon: Factory }],
	["scrap", { title: m.nav_scrap, icon: Package }],
	["production_costs", { title: m.nav_production_costs, icon: Calculator }],
	["stock", { title: m.nav_stock_ledger, icon: Warehouse }],
	["purchase_requests", { title: () => "Permintaan Pembelian", icon: ShoppingCart }],
	["purchases", { title: m.nav_purchase_orders, icon: ShoppingCart }],
	["material_receipts", { title: m.nav_material_receipts, icon: Package }],
	["material_issues", { title: m.nav_material_issues, icon: Package }],
	["stock_opnames", { title: m.nav_stock_opnames, icon: Warehouse }],
	["stock_adjustments", { title: m.nav_stock_adjustments, icon: FileChartColumn }],
	["product_batches", { title: m.nav_product_batches, icon: Package }],
	["attendance", { title: m.nav_attendance, icon: UserRound }],
	["operator_work_logs", { title: m.nav_operator_work_logs, icon: FileChartColumn }],
	["cash_advances", { title: m.nav_cash_advances, icon: Coins }],
	["piece_rate_payments", { title: m.nav_piece_rate_payments, icon: Banknote }],
	["petty_cash", { title: m.nav_petty_cash, icon: Coins }],
	["payment_requests", { title: m.nav_payment_requests, icon: Banknote }],
	["sales_invoices", { title: m.nav_sales_invoices, icon: FileChartColumn }],
	["sales_payments", { title: m.nav_sales_payments, icon: Banknote }],
	["purchase_invoices", { title: m.nav_purchase_invoices, icon: FileChartColumn }],
	["purchase_payments", { title: m.nav_purchase_payments, icon: Banknote }],
	["operational_expenses", { title: m.nav_operational_expenses, icon: Banknote }],
	["assets_list", { title: m.nav_assets_list, icon: Building2 }],
	["asset_depreciation", { title: m.nav_asset_depreciation, icon: Calculator }],
	["cost_allocations", { title: m.nav_cost_allocations, icon: Calculator }],
	["journals", { title: m.nav_journals, icon: Calculator }],
	["general_ledger", { title: m.nav_general_ledger, icon: BookOpen }],
	["trial_balance", { title: m.nav_trial_balance, icon: FileChartColumn }],
	["income_statement", { title: m.nav_income_statement, icon: FileChartColumn }],
	["balance_sheet", { title: m.nav_balance_sheet, icon: FileChartColumn }],
	["cash_flows", { title: m.nav_cash_flows, icon: FileChartColumn }],
	["reports", { title: m.nav_reports, icon: FileChartColumn }],
	["control", { title: m.nav_control, icon: ShieldCheck }],
	["tenants", { title: m.nav_tenants, icon: Building2 }],
	["users", { title: m.nav_users_access, icon: Users }],
	["operators", { title: m.nav_operators, icon: Settings }],
]);

function isNavGroupKey(value: unknown): value is NavGroupKey {
	return typeof value === "string" && GROUP_LABELS.has(value as NavGroupKey);
}

function readCollapsedNavGroups() {
	if (typeof window === "undefined") return new Set<NavGroupKey>();

	try {
		const rawValue = window.localStorage.getItem(COLLAPSED_NAV_GROUPS_STORAGE_KEY);
		if (!rawValue) return new Set<NavGroupKey>();

		const parsedValue: unknown = JSON.parse(rawValue);
		if (!Array.isArray(parsedValue)) return new Set<NavGroupKey>();
		if (!parsedValue.every(isNavGroupKey)) return new Set<NavGroupKey>();

		return new Set<NavGroupKey>(parsedValue);
	} catch {
		return new Set<NavGroupKey>();
	}
}

function writeCollapsedNavGroups(collapsedGroups: Set<NavGroupKey>) {
	try {
		window.localStorage.setItem(
			COLLAPSED_NAV_GROUPS_STORAGE_KEY,
			JSON.stringify(Array.from(collapsedGroups)),
		);
	} catch {
		// Preferensi UI boleh gagal disimpan tanpa memblokir navigasi.
	}
}

function isNavActive(pathname: string, to: string, exact?: boolean) {
	return exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
}

function getQueryErrorStatus(error: unknown) {
	if (error && typeof error === "object" && "status" in error) {
		const status = Number((error as { status: unknown }).status);
		if (Number.isFinite(status)) return status;
	}
	return undefined;
}

export function DashboardScreen() {
	const navigate = useNavigate();
	const {
		data: response,
		error: sessionError,
		isLoading,
		isError,
	} = useBackendApiAuthGetCapabilities({
		query: { retry: false },
	});
	const session = response?.status === 200 ? response.data : undefined;
	const sessionErrorStatus = getQueryErrorStatus(sessionError);
	const logoutMutation = useBackendApiAuthApiLogout();
	const availableTenants = useBackendApiAuthGetAvailableTenants({
		query: { enabled: Boolean(session), retry: false },
	});
	const tenantOptions = availableTenants.data?.status === 200 ? availableTenants.data.data : [];
	const switchTenant = useBackendApiAuthSwitchTenant();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const passwordStore = useMemo(() => new Store(false), []);
	const passwordOpen = useStore(passwordStore);
	const collapsedNavGroupsStore = useMemo(() => new Store(readCollapsedNavGroups()), []);
	const collapsedNavGroups = useStore(collapsedNavGroupsStore);
	const navigation = useMemo(() => buildNavigation(session?.capabilities), [session?.capabilities]);

	useEffect(() => {
		if (sessionErrorStatus === 401) {
			void navigate({ to: "/login", replace: true });
		}
	}, [navigate, sessionErrorStatus]);

	const setNavGroupOpen = (groupKey: NavGroupKey, open: boolean) => {
		collapsedNavGroupsStore.setState((currentGroups) => {
			const nextGroups = new Set(currentGroups);
			if (open) {
				nextGroups.delete(groupKey);
			} else {
				nextGroups.add(groupKey);
			}
			writeCollapsedNavGroups(nextGroups);
			return nextGroups;
		});
	};

	const handleLogout = async () => {
		await logoutMutation.mutateAsync();
		await navigate({ to: "/login" });
	};

	const handleTenantSwitch = async (tenantSlug: string) => {
		if (!tenantSlug || tenantSlug === session?.tenant.slug) return;
		await switchTenant.mutateAsync({ data: { tenant_slug: tenantSlug } });
		// TEN-006: jangan pertahankan cache tenant, filter, atau mutation lama.
		queryClient.clear();
		await navigate({ to: "/dashboard", replace: true });
	};

	if (isLoading || sessionErrorStatus === 401) {
		return (
			<div className="flex min-h-svh items-center justify-center bg-background p-6">
				<Card className="w-full max-w-sm">
					<CardContent className="flex flex-col gap-4 pt-6">
						<Skeleton className="h-6 w-40" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
					</CardContent>
				</Card>
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex min-h-svh items-center justify-center bg-background p-6">
				<Alert variant="destructive" className="max-w-md">
					<AlertDescription>{m.shell_session_error()}</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<SidebarProvider>
			<Sidebar collapsible="icon">
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton asChild size="lg" tooltip={m.brand_dashboard()}>
								<Link to="/dashboard">
									<Factory />
									<span className="font-semibold group-data-[collapsible=icon]:hidden">
										{m.brand_dashboard()}
									</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarHeader>

				<SidebarContent>
					{navigation.map((group) => {
						const label = GROUP_LABELS.get(group.key)?.() ?? group.key;
						const isGroupOpen = !collapsedNavGroups.has(group.key);
						return (
							<Collapsible
								key={group.key}
								open={isGroupOpen}
								onOpenChange={(open) => setNavGroupOpen(group.key, open)}
							>
								<SidebarGroup>
									<SidebarGroupLabel asChild>
										<CollapsibleTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-expanded={isGroupOpen}
												aria-label={
													isGroupOpen
														? m.shell_collapse_nav_group({ group: label })
														: m.shell_expand_nav_group({ group: label })
												}
												className="w-full cursor-pointer justify-between"
											>
												<span className="truncate">{label}</span>
												<ChevronDown
													className={cn(
														"ml-auto transition-transform duration-200",
														!isGroupOpen && "-rotate-90",
													)}
												/>
											</Button>
										</CollapsibleTrigger>
									</SidebarGroupLabel>
									<CollapsibleContent asChild>
										<SidebarGroupContent>
											<SidebarMenu>
												{group.items.map((item) => {
													const meta = ITEM_META.get(item.key);
													if (!meta) return null;
													const Icon = meta.icon;
													return (
														<SidebarMenuItem key={item.to}>
															<SidebarMenuButton
																asChild
																isActive={isNavActive(
																	pathname,
																	item.to,
																	"exact" in item ? item.exact : false,
																)}
																tooltip={meta.title()}
															>
																<Link to={item.to}>
																	<Icon />
																	<span>{meta.title()}</span>
																</Link>
															</SidebarMenuButton>
														</SidebarMenuItem>
													);
												})}
											</SidebarMenu>
										</SidebarGroupContent>
									</CollapsibleContent>
								</SidebarGroup>
							</Collapsible>
						);
					})}
				</SidebarContent>

				<SidebarFooter>
					<SidebarSeparator />
					<SidebarMenu>
						<SidebarMenuItem>
							<DropdownMenu>
								<SidebarMenuButton asChild size="lg">
									<DropdownMenuTrigger aria-label={session?.user.full_name ?? m.common_user()}>
										<UserRound />
										<span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
											<span className="truncate font-medium">
												{session?.user.full_name ?? m.common_user()}
											</span>
											<span className="truncate text-xs text-sidebar-foreground/70">
												{session?.role}
											</span>
										</span>
									</DropdownMenuTrigger>
								</SidebarMenuButton>
								<DropdownMenuContent side="top" align="start" className="w-56">
									<DropdownMenuGroup>
										<DropdownMenuItem onSelect={() => passwordStore.setState(() => true)}>
											<KeyRound />
											{m.account_change_password()}
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() => void handleLogout()}
											disabled={logoutMutation.isPending}
										>
											<LogOut />
											{m.common_sign_out()}
										</DropdownMenuItem>
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>

			<SidebarInset>
				<header className="flex min-h-14 flex-wrap items-center gap-2 border-b px-4 py-2">
					<SidebarTrigger aria-label={m.shell_toggle_navigation()} />
					<div className="hidden items-center gap-2 text-sm font-medium text-muted-foreground sm:flex">
						<BookOpen />
						<span>{m.app_name()}</span>
					</div>
					<div className="ml-auto flex min-w-0 items-center gap-2">
						<Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						{tenantOptions.length > 1 && can(session?.capabilities, "tenant.switch") ? (
							<NativeSelect
								aria-label={m.shell_active_tenant()}
								className="max-w-56"
								value={session?.tenant.slug}
								disabled={switchTenant.isPending}
								onChange={(event) => void handleTenantSwitch(event.target.value)}
							>
								{tenantOptions.map((tenant) => (
									<NativeSelectOption key={tenant.slug} value={tenant.slug}>
										{tenant.name}
									</NativeSelectOption>
								))}
							</NativeSelect>
						) : (
							<span className="truncate text-sm font-semibold">{session?.tenant.name}</span>
						)}
					</div>
				</header>
				<Outlet />
			</SidebarInset>
			<ChangePasswordDialog
				open={passwordOpen}
				onOpenChange={(open) => passwordStore.setState(() => open)}
			/>
		</SidebarProvider>
	);
}
