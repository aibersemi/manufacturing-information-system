import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ children, className, loop }, ref) => (
	<TabsPrimitive.List
		ref={ref}
		loop={loop}
		className={cn(
			"inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
			className,
		)}
	>
		{children}
	</TabsPrimitive.List>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ children, className, disabled, value }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		value={value}
		disabled={disabled}
		className={cn(
			"inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
			className,
		)}
	>
		{children}
	</TabsPrimitive.Trigger>
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ children, className, forceMount, value }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		value={value}
		forceMount={forceMount}
		className={cn(
			"mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			className,
		)}
	>
		{children}
	</TabsPrimitive.Content>
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
