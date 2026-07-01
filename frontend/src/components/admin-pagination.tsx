import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import * as m from "@/paraglide/messages";

function AdminPagination({
	page,
	pageSize,
	total,
	totalPages,
	onPageChange,
}: {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}) {
	const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const to = Math.min(page * pageSize, total);
	return (
		<div className="flex flex-col gap-3 border-t px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
			<span>{m.common_page_summary({ from, to, total })}</span>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label={m.ui_previous()}
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
				>
					<ChevronLeft />
				</Button>
				<span className="min-w-16 text-center font-medium text-foreground">
					{page} / {totalPages}
				</span>
				<Button
					type="button"
					variant="outline"
					size="icon"
					aria-label={m.ui_next()}
					disabled={page >= totalPages}
					onClick={() => onPageChange(page + 1)}
				>
					<ChevronRight />
				</Button>
			</div>
		</div>
	);
}

export { AdminPagination };
