import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { rootRoute } from "./root";
export const dashboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/dashboard",
	component: lazyRouteComponent(() => import("./dashboard.lazy"), "DashboardScreen"),
});
