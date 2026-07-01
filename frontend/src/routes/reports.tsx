import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";
import { dashboardRoute } from "./dashboard";

const searchSchema = z.object({
	report: z.string().default("sales_orders"),
	date_from: z.string().optional(),
	date_to: z.string().optional(),
});
export const reportsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "reports",
	validateSearch: searchSchema,
	component: lazyRouteComponent(() => import("./reports.lazy"), "ReportsRouteScreen"),
});
