import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type PaymentRequestsSearch = {
	action?: "create";
};

export const paymentRequestsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "finance/payment-requests",
	validateSearch: (search: Record<string, unknown>): PaymentRequestsSearch => ({
		action: search.action === "create" ? "create" : undefined,
	}),
	component: lazyRouteComponent(
		() => import("./payment-requests.lazy"),
		"PaymentRequestsRouteScreen",
	),
});
