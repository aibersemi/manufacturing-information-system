import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const productionOrderDetailRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/production/orders/$orderId",
	component: lazyRouteComponent(
		() => import("./orders.$orderId.lazy"),
		"ProductionOrderDetailRouteScreen",
	),
});
