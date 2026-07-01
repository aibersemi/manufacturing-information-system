import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PurchasePaymentsSearch = {
	action?: "create";
};

export const purchasePaymentsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/purchase-payments",
	validateSearch: (search: Record<string, unknown>): PurchasePaymentsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(
		() => import("./purchase-payments.lazy"),
		"PurchasePaymentsRouteScreen",
	),
});
