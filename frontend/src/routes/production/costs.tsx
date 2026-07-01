import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type ProductionCostsSearch = {
	action?: "create";
};

export const productionCostsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/production/costs",
	validateSearch: (search: Record<string, unknown>): ProductionCostsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./costs.lazy"), "ProductionCostsRouteScreen"),
});
