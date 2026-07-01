import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
	"relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
	{
		variants: {
			variant: {
				default: "bg-background text-foreground",
				destructive:
					"border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

type AlertProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id"> &
	VariantProps<typeof alertVariants>;

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
	({ children, className, id, variant }, ref) => (
		<div ref={ref} id={id} role="alert" className={cn(alertVariants({ variant }), className)}>
			{children}
		</div>
	),
);
Alert.displayName = "Alert";

type AlertTitleProps = Pick<React.ComponentProps<"h5">, "children" | "className" | "id">;

const AlertTitle = React.forwardRef<HTMLParagraphElement, AlertTitleProps>(
	({ children, className, id }, ref) => (
		<h5 ref={ref} id={id} className={cn("mb-1 font-medium leading-none tracking-tight", className)}>
			{children}
		</h5>
	),
);
AlertTitle.displayName = "AlertTitle";

type AlertDescriptionProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

const AlertDescription = React.forwardRef<HTMLParagraphElement, AlertDescriptionProps>(
	({ children, className, id }, ref) => (
		<div ref={ref} id={id} className={cn("text-sm [&_p]:leading-relaxed", className)}>
			{children}
		</div>
	),
);
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertDescription, AlertTitle };
