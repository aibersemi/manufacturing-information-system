import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import * as React from "react";
import { type ButtonProps, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";

type PaginationProps = Pick<React.ComponentProps<"nav">, "children" | "className" | "id">;

const Pagination = ({ children, className, id }: PaginationProps) => (
	<nav
		id={id}
		aria-label={m.ui_pagination()}
		className={cn("mx-auto flex w-full justify-center", className)}
	>
		{children}
	</nav>
);
Pagination.displayName = "Pagination";

type PaginationListProps = Pick<React.ComponentProps<"ul">, "children" | "className" | "id">;

const PaginationContent = React.forwardRef<HTMLUListElement, PaginationListProps>(
	({ children, className, id }, ref) => (
		<ul ref={ref} id={id} className={cn("flex flex-row items-center gap-1", className)}>
			{children}
		</ul>
	),
);
PaginationContent.displayName = "PaginationContent";

type PaginationItemProps = Pick<React.ComponentProps<"li">, "children" | "className" | "id">;

const PaginationItem = React.forwardRef<HTMLLIElement, PaginationItemProps>(
	({ children, className, id }, ref) => (
		<li ref={ref} id={id} className={cn("", className)}>
			{children}
		</li>
	),
);
PaginationItem.displayName = "PaginationItem";

type PaginationLinkProps = {
	isActive?: boolean;
} & Pick<ButtonProps, "size"> &
	Pick<
		React.ComponentProps<"a">,
		"aria-label" | "children" | "className" | "href" | "id" | "onClick" | "rel" | "target"
	>;

const PaginationLink = ({
	"aria-label": ariaLabel,
	children,
	className,
	href,
	id,
	isActive,
	onClick,
	rel,
	size = "icon",
	target,
}: PaginationLinkProps) => (
	<a
		id={id}
		href={href}
		target={target}
		rel={rel}
		aria-label={ariaLabel}
		aria-current={isActive ? "page" : undefined}
		onClick={onClick}
		className={cn(
			buttonVariants({
				variant: isActive ? "outline" : "ghost",
				size,
			}),
			className,
		)}
	>
		{children}
	</a>
);
PaginationLink.displayName = "PaginationLink";

const PaginationPrevious = ({
	"aria-label": ariaLabel,
	children,
	className,
	href,
	id,
	onClick,
	rel,
	target,
}: React.ComponentProps<typeof PaginationLink>) => (
	<PaginationLink
		id={id}
		href={href}
		target={target}
		rel={rel}
		onClick={onClick}
		aria-label={ariaLabel ?? m.ui_previous()}
		size="default"
		className={cn("gap-1 pl-2.5", className)}
	>
		<ChevronLeft className="h-4 w-4" />
		<span>{children ?? m.ui_previous()}</span>
	</PaginationLink>
);
PaginationPrevious.displayName = "PaginationPrevious";

const PaginationNext = ({
	"aria-label": ariaLabel,
	children,
	className,
	href,
	id,
	onClick,
	rel,
	target,
}: React.ComponentProps<typeof PaginationLink>) => (
	<PaginationLink
		id={id}
		href={href}
		target={target}
		rel={rel}
		onClick={onClick}
		aria-label={ariaLabel ?? m.ui_next()}
		size="default"
		className={cn("gap-1 pr-2.5", className)}
	>
		<span>{children ?? m.ui_next()}</span>
		<ChevronRight className="h-4 w-4" />
	</PaginationLink>
);
PaginationNext.displayName = "PaginationNext";

type PaginationEllipsisProps = Pick<React.ComponentProps<"span">, "className" | "id">;

const PaginationEllipsis = ({ className, id }: PaginationEllipsisProps) => (
	<span id={id} aria-hidden className={cn("flex h-9 w-9 items-center justify-center", className)}>
		<MoreHorizontal className="h-4 w-4" />
		<span className="sr-only">{m.ui_more_pages()}</span>
	</span>
);
PaginationEllipsis.displayName = "PaginationEllipsis";

export {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
};
