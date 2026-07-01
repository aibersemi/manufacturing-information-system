import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

export const queryClient = new QueryClient();

export const rootRoute = createRootRoute({
	component: () => (
		<QueryClientProvider client={queryClient}>
			<Outlet />
			<Toaster position="top-right" />
		</QueryClientProvider>
	),
});
