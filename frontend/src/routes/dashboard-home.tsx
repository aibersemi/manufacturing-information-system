import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "./dashboard";
export const dashboardHomeRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/",
	component: lazyRouteComponent(() => import("./dashboard-home.lazy"), "DashboardHome"),
});
