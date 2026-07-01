import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PieceRatesSearch = {
	action?: "create";
};

export const pieceRatesRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/piece-rates",
	validateSearch: (search: Record<string, unknown>): PieceRatesSearch => {
		return {
			action: search.action === "create" ? "create" : undefined,
		};
	},
	component: lazyRouteComponent(() => import("./piece-rates.lazy"), "PieceRatesRouteScreen"),
});
