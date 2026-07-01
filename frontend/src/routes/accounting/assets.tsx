import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const assetsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/accounting/assets",
	component: lazyRouteComponent(() => import("./assets.lazy"), "AssetsRouteScreen"),
});
