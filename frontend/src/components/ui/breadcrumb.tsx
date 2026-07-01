import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";

const Breadcrumb = React.forwardRef<
	HTMLElement,
	Pick<React.ComponentPropsWithoutRef<"nav">, "children" | "className" | "id"> & {
		separator?: React.ReactNode;
	}
>(({ children, className, id }, ref) => (
	<nav ref={ref} id={id} aria-label={m.ui_breadcrumb()} className={className}>
		{children}
	</nav>
));
Breadcrumb.displayName = "Breadcrumb";

type BreadcrumbListProps = Pick<
	React.ComponentPropsWithoutRef<"ol">,
	"children" | "className" | "id"
>;

const BreadcrumbList = React.forwardRef<HTMLOListElement, BreadcrumbListProps>(
	({ children, className, id }, ref) => (
		<ol
			ref={ref}
			id={id}
			className={cn(
				"flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5",
				className,
			)}
		>
			{children}
		</ol>
	),
);
BreadcrumbList.displayName = "BreadcrumbList";

type BreadcrumbItemProps = Pick<
	React.ComponentPropsWithoutRef<"li">,
	"children" | "className" | "id"
>;

const BreadcrumbItem = React.forwardRef<HTMLLIElement, BreadcrumbItemProps>(
	({ children, className, id }, ref) => (
		<li ref={ref} id={id} className={cn("inline-flex items-center gap-1.5", className)}>
			{children}
		</li>
	),
);
BreadcrumbItem.displayName = "BreadcrumbItem";

const BreadcrumbLink = React.forwardRef<
	HTMLAnchorElement,
	Pick<
		React.ComponentPropsWithoutRef<"a">,
		"aria-current" | "children" | "className" | "href" | "id" | "rel" | "target"
	> & {
		asChild?: boolean;
	}
>(({ asChild, "aria-current": ariaCurrent, children, className, href, id, rel, target }, ref) => {
	const Comp = asChild ? Slot : "a";

	return (
		<Comp
			ref={ref}
			id={id}
			href={href}
			target={target}
			rel={rel}
			aria-current={ariaCurrent}
			className={cn("transition-colors hover:text-foreground", className)}
		>
			{children}
		</Comp>
	);
});
BreadcrumbLink.displayName = "BreadcrumbLink";

type BreadcrumbPageProps = Pick<
	React.ComponentPropsWithoutRef<"span">,
	"children" | "className" | "id"
>;

const BreadcrumbPage = React.forwardRef<HTMLSpanElement, BreadcrumbPageProps>(
	({ children, className, id }, ref) => (
		<span
			ref={ref}
			id={id}
			aria-disabled="true"
			aria-current="page"
			className={cn("font-normal text-foreground", className)}
		>
			{children}
		</span>
	),
);
BreadcrumbPage.displayName = "BreadcrumbPage";

const BreadcrumbSeparator = ({ children, className, id }: BreadcrumbItemProps) => (
	<li
		id={id}
		role="presentation"
		aria-hidden="true"
		className={cn("[&>svg]:w-3.5 [&>svg]:h-3.5", className)}
	>
		{children ?? <ChevronRight />}
	</li>
);
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";

const BreadcrumbEllipsis = ({ className, id }: BreadcrumbPageProps) => (
	<span
		id={id}
		role="presentation"
		aria-hidden="true"
		className={cn("flex h-9 w-9 items-center justify-center", className)}
	>
		<MoreHorizontal className="h-4 w-4" />
		<span className="sr-only">{m.ui_more()}</span>
	</span>
);
BreadcrumbEllipsis.displayName = "BreadcrumbElipssis";

export {
	Breadcrumb,
	BreadcrumbEllipsis,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
};
