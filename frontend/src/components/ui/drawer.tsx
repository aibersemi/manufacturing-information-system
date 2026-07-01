"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

const Drawer = ({
	activeSnapPoint,
	children,
	direction,
	dismissible,
	handleOnly,
	modal,
	onAnimationEnd,
	onClose,
	onDrag,
	onOpenChange,
	onRelease,
	open,
	repositionInputs,
	setActiveSnapPoint,
	shouldScaleBackground = true,
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
	<DrawerPrimitive.Root
		activeSnapPoint={activeSnapPoint}
		direction={direction}
		dismissible={dismissible}
		handleOnly={handleOnly}
		modal={modal}
		onAnimationEnd={onAnimationEnd}
		onClose={onClose}
		onDrag={onDrag}
		onOpenChange={onOpenChange}
		onRelease={onRelease}
		open={open}
		repositionInputs={repositionInputs}
		setActiveSnapPoint={setActiveSnapPoint}
		shouldScaleBackground={shouldScaleBackground}
	>
		{children}
	</DrawerPrimitive.Root>
);
Drawer.displayName = "Drawer";

const DrawerTrigger = DrawerPrimitive.Trigger;

const DrawerPortal = DrawerPrimitive.Portal;

const DrawerClose = DrawerPrimitive.Close;

const DrawerOverlay = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, forceMount }, ref) => (
	<DrawerPrimitive.Overlay
		ref={ref}
		forceMount={forceMount}
		className={cn("fixed inset-0 z-50 bg-black/80", className)}
	/>
));
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName;

const DrawerContent = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(
	(
		{
			children,
			className,
			forceMount,
			id,
			onCloseAutoFocus,
			onEscapeKeyDown,
			onInteractOutside,
			onOpenAutoFocus,
			onPointerDownOutside,
		},
		ref,
	) => (
		<DrawerPortal>
			<DrawerOverlay />
			<DrawerPrimitive.Content
				ref={ref}
				id={id}
				forceMount={forceMount}
				onOpenAutoFocus={onOpenAutoFocus}
				onCloseAutoFocus={onCloseAutoFocus}
				onEscapeKeyDown={onEscapeKeyDown}
				onPointerDownOutside={onPointerDownOutside}
				onInteractOutside={onInteractOutside}
				className={cn(
					"fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
					className,
				)}
			>
				<div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
				{children}
			</DrawerPrimitive.Content>
		</DrawerPortal>
	),
);
DrawerContent.displayName = "DrawerContent";

type DrawerSectionProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

const DrawerHeader = ({ children, className, id }: DrawerSectionProps) => (
	<div id={id} className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}>
		{children}
	</div>
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({ children, className, id }: DrawerSectionProps) => (
	<div id={id} className={cn("mt-auto flex flex-col gap-2 p-4", className)}>
		{children}
	</div>
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ asChild, children, className, id }, ref) => (
	<DrawerPrimitive.Title
		ref={ref}
		id={id}
		asChild={asChild}
		className={cn("text-lg font-semibold leading-none tracking-tight", className)}
	>
		{children}
	</DrawerPrimitive.Title>
));
DrawerTitle.displayName = DrawerPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ asChild, children, className, id }, ref) => (
	<DrawerPrimitive.Description
		ref={ref}
		id={id}
		asChild={asChild}
		className={cn("text-sm text-muted-foreground", className)}
	>
		{children}
	</DrawerPrimitive.Description>
));
DrawerDescription.displayName = DrawerPrimitive.Description.displayName;

export {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerOverlay,
	DrawerPortal,
	DrawerTitle,
	DrawerTrigger,
};
