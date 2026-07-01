import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type OperationalExpensesSearch = {
	action?: "create";
};

export const operationalExpensesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/expenses",
	validateSearch: (search: Record<string, unknown>): OperationalExpensesSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./expenses.lazy"), "OperationalExpensesRouteScreen"),
});
