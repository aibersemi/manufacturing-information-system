import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const routingDetailRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/routings/$routingId",
	component: lazyRouteComponent(
		() => import("./routings.$routingId.lazy"),
		"RoutingDetailRouteScreen",
	),
});
