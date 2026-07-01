import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const tenantsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/settings/tenants",
	component: lazyRouteComponent(() => import("./tenants.lazy"), "TenantsScreen"),
});
