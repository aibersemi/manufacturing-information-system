import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type ProductionProgressSearch = {
	action?: "create";
};

export const productionProgressRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/production/progress",
	validateSearch: (search: Record<string, unknown>): ProductionProgressSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./progress.lazy"), "ProductionProgressRouteScreen"),
});
