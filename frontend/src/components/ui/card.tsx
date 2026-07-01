import { Slot } from "@radix-ui/react-slot";
import * as React from "react";

import { cn } from "@/lib/utils";

interface CardProps extends Pick<React.ComponentProps<"div">, "children" | "className" | "id"> {
	variant?: "default" | "glass";
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
	({ children, className, id, variant = "default" }, ref) => (
		<div
			ref={ref}
			id={id}
			className={cn(
				"rounded-lg border bg-card text-card-foreground shadow-sm",
				variant === "glass" && "glass-card",
				className,
			)}
		>
			{children}
		</div>
	),
);
Card.displayName = "Card";

type CardSectionProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

const CardHeader = React.forwardRef<HTMLDivElement, CardSectionProps>(
	({ children, className, id }, ref) => (
		<div ref={ref} id={id} className={cn("flex flex-col gap-1.5 p-6", className)}>
			{children}
		</div>
	),
);
CardHeader.displayName = "CardHeader";

interface CardTitleProps extends Pick<React.ComponentProps<"h2">, "children" | "className" | "id"> {
	asChild?: boolean;
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
	({ asChild = false, children, className, id }, ref) => {
		const Comp = asChild ? Slot : "h2";
		return (
			<Comp
				ref={ref}
				id={id}
				className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
			>
				{children}
			</Comp>
		);
	},
);
CardTitle.displayName = "CardTitle";

type CardDescriptionProps = Pick<React.ComponentProps<"p">, "children" | "className" | "id">;

const CardDescription = React.forwardRef<HTMLParagraphElement, CardDescriptionProps>(
	({ children, className, id }, ref) => (
		<p ref={ref} id={id} className={cn("text-sm text-muted-foreground", className)}>
			{children}
		</p>
	),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, CardSectionProps>(
	({ children, className, id }, ref) => (
		<div ref={ref} id={id} className={cn("p-6 pt-0", className)}>
			{children}
		</div>
	),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, CardSectionProps>(
	({ children, className, id }, ref) => (
		<div ref={ref} id={id} className={cn("flex items-center p-6 pt-0", className)}>
			{children}
		</div>
	),
);
CardFooter.displayName = "CardFooter";

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
