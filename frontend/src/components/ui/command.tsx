"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const Command = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(
	(
		{
			children,
			className,
			disablePointerSelection,
			filter,
			label,
			loop,
			onValueChange,
			shouldFilter,
			value,
			vimBindings,
		},
		ref,
	) => (
		<CommandPrimitive
			ref={ref}
			disablePointerSelection={disablePointerSelection}
			filter={filter}
			label={label}
			loop={loop}
			shouldFilter={shouldFilter}
			value={value}
			vimBindings={vimBindings}
			onValueChange={onValueChange}
			className={cn(
				"flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
				className,
			)}
		>
			{children}
		</CommandPrimitive>
	),
);
Command.displayName = CommandPrimitive.displayName;

const CommandDialog = ({ children, defaultOpen, modal, onOpenChange, open }: DialogProps) => {
	return (
		<Dialog defaultOpen={defaultOpen} modal={modal} open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 shadow-lg">
				<Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
					{children}
				</Command>
			</DialogContent>
		</Dialog>
	);
};

const CommandInput = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Input>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(
	(
		{
			"aria-label": ariaLabel,
			className,
			disabled,
			id,
			name,
			onBlur,
			onValueChange,
			placeholder,
			value,
		},
		ref,
	) => (
		<div className="flex items-center border-b px-3" cmdk-input-wrapper="">
			<Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				ref={ref}
				id={id}
				name={name}
				value={value}
				placeholder={placeholder}
				disabled={disabled}
				aria-label={ariaLabel}
				onBlur={onBlur}
				onValueChange={onValueChange}
				className={cn(
					"flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
			/>
		</div>
	),
);

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ children, className, id }, ref) => (
	<CommandPrimitive.List
		ref={ref}
		id={id}
		className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
	>
		{children}
	</CommandPrimitive.List>
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Empty>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ children }, ref) => (
	<CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm">
		{children}
	</CommandPrimitive.Empty>
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Group>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ children, className, forceMount, heading, id, value }, ref) => (
	<CommandPrimitive.Group
		ref={ref}
		id={id}
		value={value}
		heading={heading}
		forceMount={forceMount}
		className={cn(
			"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
			className,
		)}
	>
		{children}
	</CommandPrimitive.Group>
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ alwaysRender, className, id }, ref) => (
	<CommandPrimitive.Separator
		ref={ref}
		id={id}
		alwaysRender={alwaysRender}
		className={cn("-mx-1 h-px bg-border", className)}
	/>
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ children, className, disabled, forceMount, id, keywords, onSelect, value }, ref) => (
	<CommandPrimitive.Item
		ref={ref}
		id={id}
		value={value}
		disabled={disabled}
		forceMount={forceMount}
		keywords={keywords}
		onSelect={onSelect}
		className={cn(
			"relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
			className,
		)}
	>
		{children}
	</CommandPrimitive.Item>
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

type CommandShortcutProps = Pick<React.ComponentProps<"span">, "children" | "className" | "id">;

const CommandShortcut = ({ children, className, id }: CommandShortcutProps) => {
	return (
		<span
			id={id}
			className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
		>
			{children}
		</span>
	);
};
CommandShortcut.displayName = "CommandShortcut";

export {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
};
