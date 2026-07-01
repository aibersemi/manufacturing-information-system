import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const purchaseRequestsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/inventory/purchase-requests",
	component: lazyRouteComponent(
		() => import("./purchase-requests.lazy"),
		"PurchaseRequestsRouteScreen",
	),
});
