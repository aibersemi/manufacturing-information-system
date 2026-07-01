import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type CashAdvancesSearch = {
	action?: "create";
};

export const cashAdvancesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "labor/cash-advances",
	validateSearch: (search: Record<string, unknown>): CashAdvancesSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./cash-advances.lazy"), "CashAdvancesRouteScreen"),
});
