import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
	(
		{
			align = "center",
			alignOffset,
			avoidCollisions,
			children,
			className,
			collisionPadding,
			forceMount,
			id,
			onCloseAutoFocus,
			onEscapeKeyDown,
			onFocusOutside,
			onInteractOutside,
			onOpenAutoFocus,
			onPointerDownOutside,
			side,
			sideOffset = 4,
		},
		ref,
	) => (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				ref={ref}
				id={id}
				align={align}
				alignOffset={alignOffset}
				avoidCollisions={avoidCollisions}
				collisionPadding={collisionPadding}
				forceMount={forceMount}
				side={side}
				sideOffset={sideOffset}
				onOpenAutoFocus={onOpenAutoFocus}
				onCloseAutoFocus={onCloseAutoFocus}
				onEscapeKeyDown={onEscapeKeyDown}
				onPointerDownOutside={onPointerDownOutside}
				onFocusOutside={onFocusOutside}
				onInteractOutside={onInteractOutside}
				className={cn(
					"z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
					className,
				)}
			>
				{children}
			</PopoverPrimitive.Content>
		</PopoverPrimitive.Portal>
	),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverContent, PopoverTrigger };
