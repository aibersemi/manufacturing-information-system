import * as React from "react";

import { cn } from "@/lib/utils";

type TableProps = Pick<React.ComponentProps<"table">, "children" | "className" | "id">;

const Table = React.forwardRef<HTMLTableElement, TableProps>(({ children, className, id }, ref) => (
	<div className="relative w-full overflow-auto">
		<table ref={ref} id={id} className={cn("w-full caption-bottom text-sm", className)}>
			{children}
		</table>
	</div>
));
Table.displayName = "Table";

type TableSectionProps = Pick<React.ComponentProps<"thead">, "children" | "className" | "id">;

const TableHeader = React.forwardRef<HTMLTableSectionElement, TableSectionProps>(
	({ children, className, id }, ref) => (
		<thead ref={ref} id={id} className={cn("[&_tr]:border-b", className)}>
			{children}
		</thead>
	),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, TableSectionProps>(
	({ children, className, id }, ref) => (
		<tbody ref={ref} id={id} className={cn("[&_tr:last-child]:border-0", className)}>
			{children}
		</tbody>
	),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, TableSectionProps>(
	({ children, className, id }, ref) => (
		<tfoot
			ref={ref}
			id={id}
			className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
		>
			{children}
		</tfoot>
	),
);
TableFooter.displayName = "TableFooter";

type TableRowProps = Pick<React.ComponentProps<"tr">, "children" | "className" | "id">;

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
	({ children, className, id }, ref) => (
		<tr
			ref={ref}
			id={id}
			className={cn(
				"border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
				className,
			)}
		>
			{children}
		</tr>
	),
);
TableRow.displayName = "TableRow";

type TableHeadProps = Pick<React.ComponentProps<"th">, "children" | "className" | "id">;

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
	({ children, className, id }, ref) => (
		<th
			ref={ref}
			id={id}
			className={cn(
				"h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
				className,
			)}
		>
			{children}
		</th>
	),
);
TableHead.displayName = "TableHead";

type TableCellProps = Pick<React.ComponentProps<"td">, "children" | "className" | "id">;

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
	({ children, className, id }, ref) => (
		<td
			ref={ref}
			id={id}
			className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
		>
			{children}
		</td>
	),
);
TableCell.displayName = "TableCell";

type TableCaptionProps = Pick<React.ComponentProps<"caption">, "children" | "className" | "id">;

const TableCaption = React.forwardRef<HTMLTableCaptionElement, TableCaptionProps>(
	({ children, className, id }, ref) => (
		<caption ref={ref} id={id} className={cn("mt-4 text-sm text-muted-foreground", className)}>
			{children}
		</caption>
	),
);
TableCaption.displayName = "TableCaption";

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
