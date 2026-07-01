import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";
export const progressVerificationRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "production/verify",
	component: lazyRouteComponent(() => import("./verify.lazy"), "ProgressVerificationRouteScreen"),
});
