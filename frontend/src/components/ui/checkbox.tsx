"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(
	(
		{
			"aria-invalid": ariaInvalid,
			"aria-label": ariaLabel,
			checked,
			className,
			disabled,
			id,
			name,
			onCheckedChange,
			required,
			value,
		},
		ref,
	) => (
		<CheckboxPrimitive.Root
			ref={ref}
			id={id}
			name={name}
			value={value}
			checked={checked}
			required={required}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			aria-label={ariaLabel}
			onCheckedChange={onCheckedChange}
			className={cn(
				"grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
				className,
			)}
		>
			<CheckboxPrimitive.Indicator className={cn("grid place-content-center text-current")}>
				<Check className="h-4 w-4" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	),
);
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
