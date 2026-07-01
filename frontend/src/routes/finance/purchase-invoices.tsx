import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PurchaseInvoicesSearch = {
	action?: "create";
};

export const purchaseInvoicesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/purchase-invoices",
	validateSearch: (search: Record<string, unknown>): PurchaseInvoicesSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(
		() => import("./purchase-invoices.lazy"),
		"PurchaseInvoicesRouteScreen",
	),
});
