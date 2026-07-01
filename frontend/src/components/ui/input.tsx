import * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = Pick<
	React.ComponentProps<"input">,
	| "aria-invalid"
	| "aria-label"
	| "aria-labelledby"
	| "aria-readonly"
	| "autoComplete"
	| "className"
	| "disabled"
	| "id"
	| "inputMode"
	| "min"
	| "name"
	| "onBlur"
	| "onChange"
	| "placeholder"
	| "readOnly"
	| "required"
	| "step"
	| "type"
	| "value"
> & {
	"data-sidebar"?: string;
	"data-slot"?: string;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
	(
		{
			"aria-invalid": ariaInvalid,
			"aria-label": ariaLabel,
			"aria-labelledby": ariaLabelledBy,
			"aria-readonly": ariaReadOnly,
			autoComplete,
			className,
			"data-sidebar": dataSidebar,
			"data-slot": dataSlot,
			disabled,
			id,
			inputMode,
			min,
			name,
			onBlur,
			onChange,
			placeholder,
			readOnly,
			required,
			step,
			type,
			value,
		},
		ref,
	) => {
		return (
			<input
				id={id}
				type={type}
				name={name}
				inputMode={inputMode}
				value={value}
				min={min}
				step={step}
				placeholder={placeholder}
				autoComplete={autoComplete}
				required={required}
				readOnly={readOnly}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				aria-readonly={ariaReadOnly}
				data-sidebar={dataSidebar}
				data-slot={dataSlot}
				onBlur={onBlur}
				onChange={onChange}
				className={cn(
					"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
					className,
				)}
				ref={ref}
			/>
		);
	},
);
Input.displayName = "Input";

export { Input };
