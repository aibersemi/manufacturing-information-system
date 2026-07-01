import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type SalesOrdersSearch = {
	action?: "create";
};

export const salesOrdersRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/sales/orders",
	validateSearch: (search: Record<string, unknown>): SalesOrdersSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./orders.lazy"), "SalesOrdersRouteScreen"),
});
