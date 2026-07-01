import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type CustomersSearch = {
	action?: "create";
};

export const customersRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/customers",
	validateSearch: (search: Record<string, unknown>): CustomersSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./customers.lazy"), "CustomersRouteScreen"),
});
