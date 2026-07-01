import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type SalesInvoicesSearch = {
	action?: "create";
};

export const salesInvoicesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/sales-invoices",
	validateSearch: (search: Record<string, unknown>): SalesInvoicesSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./sales-invoices.lazy"), "SalesInvoicesRouteScreen"),
});
