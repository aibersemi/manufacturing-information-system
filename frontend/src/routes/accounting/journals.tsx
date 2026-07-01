import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type JournalsSearch = {
	action?: "create";
};

export const journalsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "accounting/journals",
	validateSearch: (search: Record<string, unknown>): JournalsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./journals.lazy"), "JournalsRouteScreen"),
});
