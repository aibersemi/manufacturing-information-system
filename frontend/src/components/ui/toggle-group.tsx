"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
	size: "default",
	variant: "default",
});

const ToggleGroup = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
		VariantProps<typeof toggleVariants>
>(
	(
		{
			children,
			className,
			defaultValue,
			disabled,
			dir,
			loop,
			onValueChange,
			orientation,
			rovingFocus,
			size,
			type,
			value,
			variant,
		},
		ref,
	) => {
		const content = (
			<ToggleGroupContext.Provider value={{ variant, size }}>
				{children}
			</ToggleGroupContext.Provider>
		);
		const rootClassName = cn("flex items-center justify-center gap-1", className);

		if (type === "multiple") {
			return (
				<ToggleGroupPrimitive.Root
					ref={ref}
					type="multiple"
					value={value as string[] | undefined}
					defaultValue={defaultValue as string[] | undefined}
					disabled={disabled}
					dir={dir}
					loop={loop}
					orientation={orientation}
					rovingFocus={rovingFocus}
					onValueChange={onValueChange as ((value: string[]) => void) | undefined}
					className={rootClassName}
				>
					{content}
				</ToggleGroupPrimitive.Root>
			);
		}

		return (
			<ToggleGroupPrimitive.Root
				ref={ref}
				type="single"
				value={value as string | undefined}
				defaultValue={defaultValue as string | undefined}
				disabled={disabled}
				dir={dir}
				loop={loop}
				orientation={orientation}
				rovingFocus={rovingFocus}
				onValueChange={onValueChange as ((value: string) => void) | undefined}
				className={rootClassName}
			>
				{content}
			</ToggleGroupPrimitive.Root>
		);
	},
);

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
	React.ElementRef<typeof ToggleGroupPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
		VariantProps<typeof toggleVariants>
>(({ "aria-label": ariaLabel, children, className, disabled, size, value, variant }, ref) => {
	const context = React.useContext(ToggleGroupContext);

	return (
		<ToggleGroupPrimitive.Item
			ref={ref}
			value={value}
			disabled={disabled}
			aria-label={ariaLabel}
			className={cn(
				toggleVariants({
					variant: context.variant || variant,
					size: context.size || size,
				}),
				className,
			)}
		>
			{children}
		</ToggleGroupPrimitive.Item>
	);
});

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
