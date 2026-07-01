import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PieceRatePaymentsSearch = {
	action?: "create";
};

export const pieceRatePaymentsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "labor/payments",
	validateSearch: (search: Record<string, unknown>): PieceRatePaymentsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(() => import("./payments.lazy"), "PieceRatePaymentsRouteScreen"),
});
