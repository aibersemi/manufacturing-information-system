import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "./dashboard";
export const controlCenterRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "control",
	component: lazyRouteComponent(() => import("./control-center.lazy"), "ControlCenterRouteScreen"),
});
