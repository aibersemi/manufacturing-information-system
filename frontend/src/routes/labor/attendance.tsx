import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type AttendanceSearch = {
	action?: "create";
};

export const attendanceRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "labor/attendance",
	validateSearch: (search: Record<string, unknown>): AttendanceSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./attendance.lazy"), "AttendanceRouteScreen"),
});
