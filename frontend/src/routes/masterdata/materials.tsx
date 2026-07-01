import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type MaterialsSearch = {
	action?: "create";
};

export const materialsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/materials",
	validateSearch: (search: Record<string, unknown>): MaterialsSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./materials.lazy"), "MaterialsRouteScreen"),
});
