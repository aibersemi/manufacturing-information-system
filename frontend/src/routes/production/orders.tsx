import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type ProductionOrdersSearch = {
	action?: "create";
};

export const productionOrdersRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/production/orders",
	validateSearch: (search: Record<string, unknown>): ProductionOrdersSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./orders.lazy"), "ProductionOrdersRouteScreen"),
});
