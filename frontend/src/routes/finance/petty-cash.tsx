import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PettyCashSearch = {
	action?: "create";
};

export const pettyCashRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/petty-cash",
	validateSearch: (search: Record<string, unknown>): PettyCashSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./petty-cash.lazy"), "PettyCashRouteScreen"),
});
