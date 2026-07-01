import type { ReactNode } from "react";

import { ActionSheet } from "@/components/action-sheet";

function ResponsivePanel({
	open,
	onOpenChange,
	title,
	description,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<ActionSheet open={open} onOpenChange={onOpenChange} title={title} description={description}>
			{children}
		</ActionSheet>
	);
}

export { ResponsivePanel };
