import type { ReactNode } from "react";

import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { canAll, canAny } from "@/lib/capabilities";
import * as m from "@/paraglide/messages";

function AccessGuard({
	allOf = [],
	anyOf = [],
	children,
}: {
	allOf?: string[];
	anyOf?: string[];
	children: ReactNode;
}) {
	const session = useBackendApiAuthGetCapabilities({ query: { retry: false } });
	const data = session.data?.status === 200 ? session.data.data : undefined;

	if (session.isLoading) {
		return <Skeleton className="m-6 h-48 lg:m-8" />;
	}
	if (
		!data ||
		(allOf.length > 0 && !canAll(data.capabilities, allOf)) ||
		(anyOf.length > 0 && !canAny(data.capabilities, anyOf))
	) {
		return (
			<div className="p-4 sm:p-6 lg:p-8">
				<Alert variant="destructive">
					<AlertTitle>{m.access_denied_title()}</AlertTitle>
					<AlertDescription>{m.access_denied_description()}</AlertDescription>
				</Alert>
			</div>
		);
	}
	return children;
}

export { AccessGuard };
