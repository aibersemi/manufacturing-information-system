import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(
	(
		{
			"aria-invalid": ariaInvalid,
			"aria-label": ariaLabel,
			"aria-labelledby": ariaLabelledBy,
			asChild,
			children,
			className,
			disabled,
			id,
			name,
		},
		ref,
	) => (
		<SelectPrimitive.Trigger
			ref={ref}
			id={id}
			name={name}
			asChild={asChild}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			className={cn(
				"flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
				className,
			)}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="h-4 w-4 opacity-50" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	),
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className }, ref) => (
	<SelectPrimitive.ScrollUpButton
		ref={ref}
		className={cn("flex cursor-default items-center justify-center py-1", className)}
	>
		<ChevronUp className="h-4 w-4" />
	</SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className }, ref) => (
	<SelectPrimitive.ScrollDownButton
		ref={ref}
		className={cn("flex cursor-default items-center justify-center py-1", className)}
	>
		<ChevronDown className="h-4 w-4" />
	</SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(
	(
		{
			align,
			children,
			className,
			collisionPadding,
			forceMount,
			id,
			onCloseAutoFocus,
			onEscapeKeyDown,
			onPointerDownOutside,
			position = "popper",
			side,
			sideOffset,
		},
		ref,
	) => (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				ref={ref}
				id={id}
				align={align}
				collisionPadding={collisionPadding}
				forceMount={forceMount}
				side={side}
				sideOffset={sideOffset}
				onCloseAutoFocus={onCloseAutoFocus}
				onEscapeKeyDown={onEscapeKeyDown}
				onPointerDownOutside={onPointerDownOutside}
				className={cn(
					"relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
					position === "popper" &&
						"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
					className,
				)}
				position={position}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport
					className={cn(
						"p-1",
						position === "popper" &&
							"h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
					)}
				>
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	),
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ children, className, id }, ref) => (
	<SelectPrimitive.Label
		ref={ref}
		id={id}
		className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
	>
		{children}
	</SelectPrimitive.Label>
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ children, className, disabled, id, textValue, value }, ref) => (
	<SelectPrimitive.Item
		ref={ref}
		id={id}
		value={value}
		disabled={disabled}
		textValue={textValue}
		className={cn(
			"relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<Check className="h-4 w-4" />
			</SelectPrimitive.ItemIndicator>
		</span>

		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
	React.ElementRef<typeof SelectPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, id }, ref) => (
	<SelectPrimitive.Separator
		ref={ref}
		id={id}
		className={cn("-mx-1 my-1 h-px bg-muted", className)}
	/>
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
