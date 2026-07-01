import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type MaterialReceiptsSearch = {
	action?: "create";
};

export const materialReceiptsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/inventory/receipts",
	validateSearch: (search: Record<string, unknown>): MaterialReceiptsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./receipts.lazy"), "MaterialReceiptsRouteScreen"),
});
