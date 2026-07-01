import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";

type DataEmptyProps = {
	title: string;
	description?: string;
	className?: string;
};

function DataEmpty({ title, description, className }: DataEmptyProps) {
	return (
		<Empty className={cn("border", className)}>
			<EmptyHeader>
				<EmptyTitle>{title}</EmptyTitle>
				{description ? <EmptyDescription>{description}</EmptyDescription> : null}
			</EmptyHeader>
		</Empty>
	);
}

function DataLoading({ rows = 4 }: { rows?: number }) {
	return (
		<div className="flex flex-col gap-3" role="status" aria-label={m.common_loading_data()}>
			{Array.from({ length: rows }, (_, index) => `loading-row-${index}`).map((rowId) => (
				<Skeleton key={rowId} className="h-10 w-full" />
			))}
		</div>
	);
}

function DataError({ onRetry }: { onRetry?: () => void }) {
	return (
		<Alert variant="destructive">
			<AlertTriangle aria-hidden="true" />
			<AlertTitle>{m.common_data_error_title()}</AlertTitle>
			<AlertDescription className="flex flex-col items-start gap-3">
				<span>{m.common_data_error_description()}</span>
				{onRetry ? (
					<Button type="button" variant="outline" size="sm" onClick={onRetry}>
						<RefreshCw data-icon="inline-start" /> {m.common_retry()}
					</Button>
				) : null}
			</AlertDescription>
		</Alert>
	);
}

export { DataEmpty, DataError, DataLoading };

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
