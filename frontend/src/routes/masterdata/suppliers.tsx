import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type SuppliersSearch = {
	action?: "create";
};

export const suppliersRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/suppliers",
	validateSearch: (search: Record<string, unknown>): SuppliersSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./suppliers.lazy"), "SuppliersRouteScreen"),
});
