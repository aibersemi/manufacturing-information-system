import { createRoute } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import { dashboardRoute } from "../dashboard";

export const reworkRoute = createRoute({
	getParentRoute: () => dashboardRoute,
	path: "/production/rework",
	component: () => (
		<div className="flex h-full items-center justify-center p-6">
			<div className="text-center text-muted-foreground">{m.common_page_under_development()}</div>
		</div>
	),
});
