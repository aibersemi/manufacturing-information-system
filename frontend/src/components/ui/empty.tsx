import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

type EmptyDivProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

function Empty({ children, className, id }: EmptyDivProps) {
	return (
		<div
			id={id}
			data-slot="empty"
			className={cn(
				"flex min-w-0 flex-1 flex-col items-center justify-center gap-6 text-balance rounded-lg border-dashed p-6 text-center md:p-12",
				className,
			)}
		>
			{children}
		</div>
	);
}

function EmptyHeader({ children, className, id }: EmptyDivProps) {
	return (
		<div
			id={id}
			data-slot="empty-header"
			className={cn("flex max-w-sm flex-col items-center gap-2 text-center", className)}
		>
			{children}
		</div>
	);
}

const emptyMediaVariants = cva(
	"mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-transparent",
				icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function EmptyMedia({
	children,
	className,
	id,
	variant = "default",
}: EmptyDivProps & VariantProps<typeof emptyMediaVariants>) {
	return (
		<div
			id={id}
			data-slot="empty-icon"
			data-variant={variant}
			className={cn(emptyMediaVariants({ variant, className }))}
		>
			{children}
		</div>
	);
}

function EmptyTitle({ children, className, id }: EmptyDivProps) {
	return (
		<div
			id={id}
			data-slot="empty-title"
			className={cn("text-lg font-medium tracking-tight", className)}
		>
			{children}
		</div>
	);
}

type EmptyDescriptionProps = Pick<React.ComponentProps<"p">, "children" | "className" | "id">;

function EmptyDescription({ children, className, id }: EmptyDescriptionProps) {
	return (
		<div
			id={id}
			data-slot="empty-description"
			className={cn(
				"text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4",
				className,
			)}
		>
			{children}
		</div>
	);
}

function EmptyContent({ children, className, id }: EmptyDivProps) {
	return (
		<div
			id={id}
			data-slot="empty-content"
			className={cn(
				"flex w-full min-w-0 max-w-sm flex-col items-center gap-4 text-balance text-sm",
				className,
			)}
		>
			{children}
		</div>
	);
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle };
