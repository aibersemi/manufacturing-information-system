import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { dashboardRoute } from "../dashboard";

type ProductsSearch = {
	action?: "create-model" | "create-variant";
	modelId?: string;
};

export const productsRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/masterdata/products",
	validateSearch: (search: Record<string, unknown>): ProductsSearch => {
		return {
			action: ["create-model", "create-variant"].includes(search.action as string)
				? (search.action as "create-model" | "create-variant")
				: undefined,
			modelId: search.modelId as string | undefined,
		};
	},
	component: lazyRouteComponent(() => import("./products.lazy"), "ProductsRouteScreen"),
});
