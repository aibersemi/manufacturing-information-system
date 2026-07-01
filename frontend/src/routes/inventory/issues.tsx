import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type MaterialIssuesSearch = {
	action?: "create" | "production";
};

export const materialIssuesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "inventory/issues",
	validateSearch: (search: Record<string, unknown>): MaterialIssuesSearch => ({
		action:
			search.action === "create" || search.action === "production" ? search.action : undefined,
	}),
	component: lazyRouteComponent(() => import("./issues.lazy"), "MaterialIssuesRouteScreen"),
});
