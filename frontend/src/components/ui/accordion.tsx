"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Accordion = AccordionPrimitive.Root;
type AccordionItemProps = Pick<
	React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>,
	"className" | "disabled" | "value"
>;
type AccordionTriggerProps = Pick<
	React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger>,
	"aria-controls" | "asChild" | "children" | "className" | "disabled" | "id" | "onClick"
>;
type AccordionContentProps = Pick<
	React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>,
	"asChild" | "children" | "className" | "forceMount" | "id"
>;

const AccordionItem = React.forwardRef<
	React.ElementRef<typeof AccordionPrimitive.Item>,
	AccordionItemProps
>(({ className, disabled, value }, ref) => (
	<AccordionPrimitive.Item
		ref={ref}
		value={value}
		disabled={disabled}
		className={cn("border-b", className)}
	/>
));
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = React.forwardRef<
	React.ElementRef<typeof AccordionPrimitive.Trigger>,
	AccordionTriggerProps
>(({ "aria-controls": ariaControls, asChild, children, className, disabled, id, onClick }, ref) => (
	<AccordionPrimitive.Header className="flex">
		<AccordionPrimitive.Trigger
			ref={ref}
			id={id}
			asChild={asChild}
			disabled={disabled}
			aria-controls={ariaControls}
			onClick={onClick}
			className={cn(
				"flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
				className,
			)}
		>
			{children}
			<ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
		</AccordionPrimitive.Trigger>
	</AccordionPrimitive.Header>
));
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

const AccordionContent = React.forwardRef<
	React.ElementRef<typeof AccordionPrimitive.Content>,
	AccordionContentProps
>(({ asChild, children, className, forceMount, id }, ref) => (
	<AccordionPrimitive.Content
		ref={ref}
		id={id}
		asChild={asChild}
		forceMount={forceMount}
		className="overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
	>
		<div className={cn("pb-4 pt-0", className)}>{children}</div>
	</AccordionPrimitive.Content>
));

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
