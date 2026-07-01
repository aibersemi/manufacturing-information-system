import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const operatorsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/settings/operators",
	component: lazyRouteComponent(() => import("./operators.lazy"), "OperatorsScreen"),
});
