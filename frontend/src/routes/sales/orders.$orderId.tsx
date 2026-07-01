import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const salesOrderDetailRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/sales/orders/$orderId",
	component: lazyRouteComponent(
		() => import("./orders.$orderId.lazy"),
		"SalesOrderDetailRouteScreen",
	),
});
