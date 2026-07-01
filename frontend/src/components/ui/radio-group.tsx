import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Circle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const RadioGroup = React.forwardRef<
	React.ElementRef<typeof RadioGroupPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(
	(
		{
			children,
			className,
			defaultValue,
			disabled,
			dir,
			id,
			loop,
			name,
			onValueChange,
			orientation,
			required,
			value,
		},
		ref,
	) => {
		return (
			<RadioGroupPrimitive.Root
				ref={ref}
				id={id}
				name={name}
				value={value}
				defaultValue={defaultValue}
				required={required}
				disabled={disabled}
				dir={dir}
				loop={loop}
				orientation={orientation}
				onValueChange={onValueChange}
				className={cn("grid gap-2", className)}
			>
				{children}
			</RadioGroupPrimitive.Root>
		);
	},
);
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
	React.ElementRef<typeof RadioGroupPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ "aria-label": ariaLabel, className, disabled, id, required, value }, ref) => {
	return (
		<RadioGroupPrimitive.Item
			ref={ref}
			id={id}
			value={value}
			required={required}
			disabled={disabled}
			aria-label={ariaLabel}
			className={cn(
				"aspect-square h-4 w-4 rounded-full border border-primary text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
		>
			<RadioGroupPrimitive.Indicator className="flex items-center justify-center">
				<Circle className="h-2.5 w-2.5 fill-current text-current" />
			</RadioGroupPrimitive.Indicator>
		</RadioGroupPrimitive.Item>
	);
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
