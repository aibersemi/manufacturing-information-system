import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type UomsSearch = {
	action?: "create";
};

export const uomsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/uoms",
	validateSearch: (search: Record<string, unknown>): UomsSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./uoms.lazy"), "UomsRouteScreen"),
});
