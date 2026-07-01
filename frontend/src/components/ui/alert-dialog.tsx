import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, forceMount }, ref) => (
	<AlertDialogPrimitive.Overlay
		ref={ref}
		forceMount={forceMount}
		className={cn(
			"fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
			className,
		)}
	/>
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(
	(
		{ children, className, forceMount, onCloseAutoFocus, onEscapeKeyDown, onOpenAutoFocus },
		ref,
	) => (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Content
				ref={ref}
				forceMount={forceMount}
				onOpenAutoFocus={onOpenAutoFocus}
				onCloseAutoFocus={onCloseAutoFocus}
				onEscapeKeyDown={onEscapeKeyDown}
				className={cn(
					"fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
					className,
				)}
			>
				{children}
			</AlertDialogPrimitive.Content>
		</AlertDialogPortal>
	),
);
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

type AlertDialogSectionProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

const AlertDialogHeader = ({ children, className, id }: AlertDialogSectionProps) => (
	<div id={id} className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}>
		{children}
	</div>
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ children, className, id }: AlertDialogSectionProps) => (
	<div
		id={id}
		className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
	>
		{children}
	</div>
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ asChild, children, className, id }, ref) => (
	<AlertDialogPrimitive.Title
		ref={ref}
		id={id}
		asChild={asChild}
		className={cn("text-lg font-semibold", className)}
	>
		{children}
	</AlertDialogPrimitive.Title>
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ asChild, children, className, id }, ref) => (
	<AlertDialogPrimitive.Description
		ref={ref}
		id={id}
		asChild={asChild}
		className={cn("text-sm text-muted-foreground", className)}
	>
		{children}
	</AlertDialogPrimitive.Description>
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Action>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ asChild, children, className, disabled, id, onClick }, ref) => (
	<AlertDialogPrimitive.Action
		ref={ref}
		id={id}
		asChild={asChild}
		disabled={disabled}
		onClick={onClick}
		className={cn(buttonVariants(), className)}
	>
		{children}
	</AlertDialogPrimitive.Action>
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ asChild, children, className, disabled, id, onClick }, ref) => (
	<AlertDialogPrimitive.Cancel
		ref={ref}
		id={id}
		asChild={asChild}
		disabled={disabled}
		onClick={onClick}
		className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
	>
		{children}
	</AlertDialogPrimitive.Cancel>
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogTrigger,
};
