import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const operatorWorkLogsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "labor/work-logs",
	component: lazyRouteComponent(() => import("./work-logs.lazy"), "OperatorWorkLogsRouteScreen"),
});
