import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type NativeSelectProps = Pick<
	React.ComponentProps<"select">,
	| "aria-invalid"
	| "aria-label"
	| "children"
	| "className"
	| "disabled"
	| "id"
	| "name"
	| "onBlur"
	| "onChange"
	| "required"
	| "value"
>;

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
	(
		{
			"aria-invalid": ariaInvalid,
			"aria-label": ariaLabel,
			children,
			className,
			disabled,
			id,
			name,
			onBlur,
			onChange,
			required,
			value,
		},
		ref,
	) => (
		<div
			data-slot="native-select-wrapper"
			className={cn("relative w-fit has-[select:disabled]:opacity-50", className)}
		>
			<select
				ref={ref}
				id={id}
				name={name}
				value={value}
				required={required}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				aria-label={ariaLabel}
				data-slot="native-select"
				className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-10 text-base text-foreground outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm"
				onBlur={onBlur}
				onChange={onChange}
			>
				{children}
			</select>
			<ChevronDown
				className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
				data-slot="native-select-icon"
			/>
		</div>
	),
);
NativeSelect.displayName = "NativeSelect";

type NativeSelectOptionProps = Pick<
	React.ComponentProps<"option">,
	"children" | "className" | "disabled" | "id" | "value"
>;

const NativeSelectOption = React.forwardRef<HTMLOptionElement, NativeSelectOptionProps>(
	({ children, className, disabled, id, value }, ref) => (
		<option
			ref={ref}
			id={id}
			value={value}
			disabled={disabled}
			data-slot="native-select-option"
			className={cn("bg-background text-foreground", className)}
		>
			{children}
		</option>
	),
);
NativeSelectOption.displayName = "NativeSelectOption";

export { NativeSelect, NativeSelectOption };
