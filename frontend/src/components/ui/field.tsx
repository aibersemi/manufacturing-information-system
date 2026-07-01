import { useMemo } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldDivProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

function FieldGroup({ children, className, id }: FieldDivProps) {
	return (
		<div id={id} data-slot="field-group" className={cn("flex w-full flex-col gap-7", className)}>
			{children}
		</div>
	);
}

type FieldProps = FieldDivProps & {
	"data-invalid"?: boolean;
};

function Field({ children, className, "data-invalid": dataInvalid, id }: FieldProps) {
	return (
		<div
			id={id}
			data-slot="field"
			data-invalid={dataInvalid}
			className={cn(
				"group/field flex w-full flex-col gap-2 data-[invalid=true]:text-destructive",
				className,
			)}
		>
			{children}
		</div>
	);
}

function FieldLabel({ children, className, htmlFor, id }: React.ComponentProps<typeof Label>) {
	return (
		<Label
			id={id}
			htmlFor={htmlFor}
			data-slot="field-label"
			className={cn("w-fit leading-snug group-data-[disabled=true]/field:opacity-50", className)}
		>
			{children}
		</Label>
	);
}

function FieldError({
	className,
	children,
	errors,
	id,
}: FieldDivProps & {
	errors?: Array<{ message?: string } | undefined>;
}) {
	const content = useMemo(() => {
		if (children) return children;
		if (!errors?.length) return null;
		if (errors.length === 1) return errors[0]?.message;

		return (
			<ul className="ml-4 flex list-disc flex-col gap-1">
				{errors.map((error) =>
					error?.message ? <li key={error.message}>{error.message}</li> : null,
				)}
			</ul>
		);
	}, [children, errors]);

	if (!content) return null;

	return (
		<div
			id={id}
			role="alert"
			data-slot="field-error"
			className={cn("text-sm font-normal text-destructive", className)}
		>
			{content}
		</div>
	);
}

export { Field, FieldError, FieldGroup, FieldLabel };
