import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type AssetsSearch = {
	action?: "create";
};

export const assetsListRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/assets",
	validateSearch: (search: Record<string, unknown>): AssetsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./assets.lazy"), "AssetsListRouteScreen"),
});
