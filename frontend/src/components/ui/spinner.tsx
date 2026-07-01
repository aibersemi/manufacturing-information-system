import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";

function Spinner({
	"aria-hidden": ariaHidden,
	"aria-label": ariaLabel,
	className,
	"data-icon": dataIcon,
	id,
}: React.ComponentProps<"svg"> & { "data-icon"?: string }) {
	return (
		<Loader2Icon
			id={id}
			role="status"
			aria-hidden={ariaHidden}
			aria-label={ariaLabel ?? m.common_loading_data()}
			data-icon={dataIcon}
			className={cn("size-4 animate-spin", className)}
		/>
	);
}

export { Spinner };
