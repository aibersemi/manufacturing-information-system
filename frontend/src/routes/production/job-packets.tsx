import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type JobPacketsSearch = {
	action?: "create";
};

export const jobPacketsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/production/job-packets",
	validateSearch: (search: Record<string, unknown>): JobPacketsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./job-packets.lazy"), "JobPacketsRouteScreen"),
});
