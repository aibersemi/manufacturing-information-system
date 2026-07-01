"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "@/lib/utils";

const Progress = React.forwardRef<
	React.ElementRef<typeof ProgressPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, getValueLabel, id, max, value }, ref) => (
	<ProgressPrimitive.Root
		ref={ref}
		id={id}
		max={max}
		value={value}
		getValueLabel={getValueLabel}
		className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary", className)}
	>
		<ProgressPrimitive.Indicator
			className="h-full w-full flex-1 bg-primary transition-all"
			style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
		/>
	</ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
