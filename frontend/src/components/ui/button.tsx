import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-10 px-4 py-2",
				sm: "h-9 rounded-md px-3",
				lg: "h-11 rounded-md px-8",
				icon: "h-10 w-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends Pick<
			React.ComponentProps<"button">,
			| "aria-invalid"
			| "aria-label"
			| "aria-labelledby"
			| "aria-disabled"
			| "aria-expanded"
			| "aria-haspopup"
			| "aria-controls"
			| "aria-pressed"
			| "children"
			| "className"
			| "disabled"
			| "id"
			| "onBlur"
			| "onClick"
			| "onFocus"
			| "onKeyDown"
			| "onPointerDown"
			| "onMouseEnter"
			| "onMouseLeave"
			| "tabIndex"
			| "type"
		>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
	"data-day"?: string;
	"data-range-end"?: boolean;
	"data-range-middle"?: boolean;
	"data-range-start"?: boolean;
	"data-selected-single"?: boolean;
	"data-sidebar"?: string;
	"data-size"?: string | null;
	"data-state"?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			"aria-invalid": ariaInvalid,
			"aria-label": ariaLabel,
			"aria-labelledby": ariaLabelledBy,
			"aria-disabled": ariaDisabled,
			"aria-expanded": ariaExpanded,
			"aria-haspopup": ariaHasPopup,
			"aria-controls": ariaControls,
			"aria-pressed": ariaPressed,
			asChild = false,
			children,
			className,
			"data-day": dataDay,
			"data-range-end": dataRangeEnd,
			"data-range-middle": dataRangeMiddle,
			"data-range-start": dataRangeStart,
			"data-selected-single": dataSelectedSingle,
			"data-sidebar": dataSidebar,
			"data-size": dataSize,
			"data-state": dataState,
			disabled,
			id,
			onBlur,
			onClick,
			onFocus,
			onKeyDown,
			onPointerDown,
			onMouseEnter,
			onMouseLeave,
			size,
			tabIndex,
			type,
			variant,
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "button";
		return (
			<Comp
				ref={ref}
				id={id}
				type={type}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				aria-disabled={ariaDisabled}
				aria-expanded={ariaExpanded}
				aria-haspopup={ariaHasPopup}
				aria-controls={ariaControls}
				aria-pressed={ariaPressed}
				data-day={dataDay}
				data-selected-single={dataSelectedSingle}
				data-range-start={dataRangeStart}
				data-range-end={dataRangeEnd}
				data-range-middle={dataRangeMiddle}
				data-sidebar={dataSidebar}
				data-size={dataSize}
				data-state={dataState}
				tabIndex={tabIndex}
				onBlur={onBlur}
				onClick={onClick}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				onPointerDown={onPointerDown}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
				className={cn(buttonVariants({ variant, size, className }))}
			>
				{children}
			</Comp>
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };
