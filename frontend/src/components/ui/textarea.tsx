import * as React from "react";

import { cn } from "@/lib/utils";

type TextareaProps = Pick<
	React.ComponentProps<"textarea">,
	| "aria-invalid"
	| "className"
	| "disabled"
	| "id"
	| "name"
	| "onBlur"
	| "onChange"
	| "placeholder"
	| "required"
	| "value"
> & {
	"data-slot"?: string;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
	(
		{
			"aria-invalid": ariaInvalid,
			className,
			"data-slot": dataSlot,
			disabled,
			id,
			name,
			onBlur,
			onChange,
			placeholder,
			required,
			value,
		},
		ref,
	) => {
		return (
			<textarea
				id={id}
				name={name}
				value={value}
				placeholder={placeholder}
				required={required}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				data-slot={dataSlot}
				onBlur={onBlur}
				onChange={onChange}
				className={cn(
					"flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
					className,
				)}
				ref={ref}
			/>
		);
	},
);
Textarea.displayName = "Textarea";

export { Textarea };
