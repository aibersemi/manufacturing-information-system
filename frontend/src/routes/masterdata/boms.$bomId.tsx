import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const bomDetailRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/boms/$bomId",
	component: lazyRouteComponent(() => import("./boms.$bomId.lazy"), "BomDetailRouteScreen"),
});
