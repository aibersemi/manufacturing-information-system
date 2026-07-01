import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type CostAllocationsSearch = {
	action?: "create";
};

export const costAllocationsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/finance/cost-allocations",
	validateSearch: (search: Record<string, unknown>): CostAllocationsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(
		() => import("./cost-allocations.lazy"),
		"CostAllocationsRouteScreen",
	),
});
