import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const assetDepreciationRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/depreciation",
	component: lazyRouteComponent(
		() => import("./depreciation.lazy"),
		"AssetDepreciationRouteScreen",
	),
});
