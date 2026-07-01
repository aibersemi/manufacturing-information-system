import { cn } from "@/lib/utils";

type SkeletonProps = Pick<
	React.ComponentProps<"div">,
	"children" | "className" | "id" | "style"
> & {
	"data-sidebar"?: string;
};

function Skeleton({ children, className, id, style, "data-sidebar": dataSidebar }: SkeletonProps) {
	return (
		<div
			id={id}
			data-sidebar={dataSidebar}
			style={style}
			className={cn("animate-pulse rounded-md bg-muted", className)}
		>
			{children}
		</div>
	);
}

export { Skeleton };
