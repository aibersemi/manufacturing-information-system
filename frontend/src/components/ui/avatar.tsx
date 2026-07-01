import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as React from "react";

import { cn } from "@/lib/utils";

const Avatar = React.forwardRef<
	React.ElementRef<typeof AvatarPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ children, className, id }, ref) => (
	<AvatarPrimitive.Root
		ref={ref}
		id={id}
		className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
	>
		{children}
	</AvatarPrimitive.Root>
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
	React.ElementRef<typeof AvatarPrimitive.Image>,
	React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ alt, className, onLoadingStatusChange, src }, ref) => (
	<AvatarPrimitive.Image
		ref={ref}
		src={src}
		alt={alt}
		onLoadingStatusChange={onLoadingStatusChange}
		className={cn("aspect-square h-full w-full", className)}
	/>
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
	React.ElementRef<typeof AvatarPrimitive.Fallback>,
	React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ children, className, delayMs, id }, ref) => (
	<AvatarPrimitive.Fallback
		ref={ref}
		id={id}
		delayMs={delayMs}
		className={cn(
			"flex h-full w-full items-center justify-center rounded-full bg-muted",
			className,
		)}
	>
		{children}
	</AvatarPrimitive.Fallback>
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarFallback, AvatarImage };
