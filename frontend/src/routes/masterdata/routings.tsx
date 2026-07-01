import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type RoutingsSearch = {
	action?: "create";
};

export const routingsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/routings",
	validateSearch: (search: Record<string, unknown>): RoutingsSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./routings.lazy"), "RoutingsRouteScreen"),
});
