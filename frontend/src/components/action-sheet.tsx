import type { ReactNode } from "react";

import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";

function ActionSheet({
	open,
	onOpenChange,
	title,
	description,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="overflow-y-auto sm:max-w-xl">
				<SheetHeader className="pr-8">
					<SheetTitle>{title}</SheetTitle>
					{description ? <SheetDescription>{description}</SheetDescription> : null}
				</SheetHeader>
				<div className="mt-6">{children}</div>
			</SheetContent>
		</Sheet>
	);
}

export { ActionSheet };
