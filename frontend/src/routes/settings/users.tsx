import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const usersRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/settings/users",
	component: lazyRouteComponent(() => import("./users.lazy"), "UsersScreen"),
});
