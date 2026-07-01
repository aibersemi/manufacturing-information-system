import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type BomsSearch = {
	action?: "create";
};

export const bomsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/boms",
	validateSearch: (search: Record<string, unknown>): BomsSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./boms.lazy"), "BomsRouteScreen"),
});
