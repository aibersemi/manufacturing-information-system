import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const stockRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/inventory/stock",
	component: lazyRouteComponent(() => import("./stock.lazy"), "StockRouteScreen"),
});
