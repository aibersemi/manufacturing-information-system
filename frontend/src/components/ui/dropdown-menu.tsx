import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
		inset?: boolean;
	}
>(({ asChild, children, className, disabled, inset, onClick, onSelect, textValue }, ref) => (
	<DropdownMenuPrimitive.SubTrigger
		ref={ref}
		asChild={asChild}
		disabled={disabled}
		textValue={textValue}
		onClick={onClick}
		onSelect={onSelect}
		className={cn(
			"flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
			inset && "pl-8",
			className,
		)}
	>
		{children}
		<ChevronRight className="ml-auto" />
	</DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(
	(
		{
			alignOffset,
			avoidCollisions,
			children,
			className,
			collisionPadding,
			forceMount,
			onEscapeKeyDown,
			onFocusOutside,
			onInteractOutside,
			onPointerDownOutside,
			sideOffset,
		},
		ref,
	) => (
		<DropdownMenuPrimitive.SubContent
			ref={ref}
			alignOffset={alignOffset}
			avoidCollisions={avoidCollisions}
			collisionPadding={collisionPadding}
			forceMount={forceMount}
			sideOffset={sideOffset}
			onEscapeKeyDown={onEscapeKeyDown}
			onPointerDownOutside={onPointerDownOutside}
			onFocusOutside={onFocusOutside}
			onInteractOutside={onInteractOutside}
			className={cn(
				"z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
				className,
			)}
		>
			{children}
		</DropdownMenuPrimitive.SubContent>
	),
);
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(
	(
		{
			align,
			alignOffset,
			avoidCollisions,
			children,
			className,
			collisionPadding,
			forceMount,
			loop,
			onCloseAutoFocus,
			onEscapeKeyDown,
			onFocusOutside,
			onInteractOutside,
			onPointerDownOutside,
			side,
			sideOffset = 4,
		},
		ref,
	) => (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				ref={ref}
				align={align}
				alignOffset={alignOffset}
				avoidCollisions={avoidCollisions}
				collisionPadding={collisionPadding}
				forceMount={forceMount}
				loop={loop}
				side={side}
				sideOffset={sideOffset}
				onCloseAutoFocus={onCloseAutoFocus}
				onEscapeKeyDown={onEscapeKeyDown}
				onPointerDownOutside={onPointerDownOutside}
				onFocusOutside={onFocusOutside}
				onInteractOutside={onInteractOutside}
				className={cn(
					"z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]",
					className,
				)}
			>
				{children}
			</DropdownMenuPrimitive.Content>
		</DropdownMenuPrimitive.Portal>
	),
);
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
		inset?: boolean;
	}
>(({ asChild, children, className, disabled, id, inset, onClick, onSelect, textValue }, ref) => (
	<DropdownMenuPrimitive.Item
		ref={ref}
		id={id}
		asChild={asChild}
		disabled={disabled}
		textValue={textValue}
		onClick={onClick}
		onSelect={onSelect}
		className={cn(
			"relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
			inset && "pl-8",
			className,
		)}
	>
		{children}
	</DropdownMenuPrimitive.Item>
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(
	(
		{ asChild, checked, children, className, disabled, id, onCheckedChange, onSelect, textValue },
		ref,
	) => (
		<DropdownMenuPrimitive.CheckboxItem
			ref={ref}
			id={id}
			asChild={asChild}
			disabled={disabled}
			textValue={textValue}
			onCheckedChange={onCheckedChange}
			onSelect={onSelect}
			className={cn(
				"relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			checked={checked}
		>
			<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<DropdownMenuPrimitive.ItemIndicator>
					<Check className="h-4 w-4" />
				</DropdownMenuPrimitive.ItemIndicator>
			</span>
			{children}
		</DropdownMenuPrimitive.CheckboxItem>
	),
);
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ asChild, children, className, disabled, id, onSelect, textValue, value }, ref) => (
	<DropdownMenuPrimitive.RadioItem
		ref={ref}
		id={id}
		asChild={asChild}
		disabled={disabled}
		textValue={textValue}
		value={value}
		onSelect={onSelect}
		className={cn(
			"relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
			className,
		)}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<DropdownMenuPrimitive.ItemIndicator>
				<Circle className="h-2 w-2 fill-current" />
			</DropdownMenuPrimitive.ItemIndicator>
		</span>
		{children}
	</DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
		inset?: boolean;
	}
>(({ asChild, children, className, id, inset }, ref) => (
	<DropdownMenuPrimitive.Label
		ref={ref}
		id={id}
		asChild={asChild}
		className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
	>
		{children}
	</DropdownMenuPrimitive.Label>
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
	React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, id }, ref) => (
	<DropdownMenuPrimitive.Separator
		ref={ref}
		id={id}
		className={cn("-mx-1 my-1 h-px bg-muted", className)}
	/>
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

type DropdownMenuShortcutProps = Pick<
	React.ComponentProps<"span">,
	"children" | "className" | "id"
>;

const DropdownMenuShortcut = ({ children, className, id }: DropdownMenuShortcutProps) => {
	return (
		<span id={id} className={cn("ml-auto text-xs tracking-widest opacity-60", className)}>
			{children}
		</span>
	);
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
