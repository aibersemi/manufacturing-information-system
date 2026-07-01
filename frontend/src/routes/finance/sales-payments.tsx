import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type SalesPaymentsSearch = {
	action?: "create";
};

export const salesPaymentsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/sales-payments",
	validateSearch: (search: Record<string, unknown>): SalesPaymentsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./sales-payments.lazy"), "SalesPaymentsRouteScreen"),
});
