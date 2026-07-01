import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PurchasesSearch = {
	action?: "create";
};

export const purchasesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/inventory/purchases",
	validateSearch: (search: Record<string, unknown>): PurchasesSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./purchases.lazy"), "PurchasesRouteScreen"),
});
