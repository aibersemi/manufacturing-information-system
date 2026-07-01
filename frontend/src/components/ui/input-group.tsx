import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type InputGroupProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id">;

function InputGroup({ children, className, id }: InputGroupProps) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: Wrapper shadcn ini memakai div agar tidak mengubah semantik fieldset pada form.
		<div
			id={id}
			data-slot="input-group"
			role="group"
			className={cn(
				"group/input-group border-input dark:bg-input/30 shadow-xs relative flex w-full items-center rounded-md border outline-none transition-[color,box-shadow]",
				"h-9 has-[>textarea]:h-auto",

				// Varian berdasarkan posisi addon.
				"has-[>[data-align=inline-start]]:[&>input]:pl-2",
				"has-[>[data-align=inline-end]]:[&>input]:pr-2",
				"has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&>input]:pb-3",
				"has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3",

				// Status fokus.
				"has-[[data-slot=input-group-control]:focus-visible]:ring-ring has-[[data-slot=input-group-control]:focus-visible]:ring-1",

				// Status error.
				"has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[[data-slot][aria-invalid=true]]:border-destructive dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",

				className,
			)}
		>
			{children}
		</div>
	);
}

const inputGroupAddonVariants = cva(
	"text-muted-foreground flex h-auto cursor-text select-none items-center justify-center gap-2 py-1.5 text-sm font-medium group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
	{
		variants: {
			align: {
				"inline-start": "order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]",
				"inline-end": "order-last pr-3 has-[>button]:mr-[-0.4rem] has-[>kbd]:mr-[-0.35rem]",
				"block-start":
					"[.border-b]:pb-3 order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-2.5",
				"block-end":
					"[.border-t]:pt-3 order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-2.5",
			},
		},
		defaultVariants: {
			align: "inline-start",
		},
	},
);

function InputGroupAddon({
	children,
	className,
	align = "inline-start",
	id,
}: InputGroupProps & VariantProps<typeof inputGroupAddonVariants>) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: Addon shadcn tidak selalu field group form.
		// biome-ignore lint/a11y/useKeyWithClickEvents: Addon hanya memfokuskan input induk; aksi utama tetap ada pada kontrol input.
		<div
			id={id}
			role="group"
			data-slot="input-group-addon"
			data-align={align}
			className={cn(inputGroupAddonVariants({ align }), className)}
			onClick={(e) => {
				if ((e.target as HTMLElement).closest("button")) {
					return;
				}
				e.currentTarget.parentElement?.querySelector("input")?.focus();
			}}
		>
			{children}
		</div>
	);
}

const inputGroupButtonVariants = cva("flex items-center gap-2 text-sm shadow-none", {
	variants: {
		size: {
			xs: "h-6 gap-1 rounded-[calc(var(--radius)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
			sm: "h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5",
			"icon-xs": "size-6 rounded-[calc(var(--radius)-5px)] p-0 has-[>svg]:p-0",
			"icon-sm": "size-8 p-0 has-[>svg]:p-0",
		},
	},
	defaultVariants: {
		size: "xs",
	},
});

function InputGroupButton({
	"aria-label": ariaLabel,
	children,
	className,
	disabled,
	id,
	onClick,
	type = "button",
	variant = "ghost",
	size = "xs",
}: Omit<React.ComponentProps<typeof Button>, "size"> &
	VariantProps<typeof inputGroupButtonVariants>) {
	return (
		<Button
			id={id}
			type={type}
			disabled={disabled}
			aria-label={ariaLabel}
			data-size={size}
			variant={variant}
			onClick={onClick}
			className={cn(inputGroupButtonVariants({ size }), className)}
		>
			{children}
		</Button>
	);
}

type InputGroupTextProps = Pick<React.ComponentProps<"span">, "children" | "className" | "id">;

function InputGroupText({ children, className, id }: InputGroupTextProps) {
	return (
		<span
			id={id}
			className={cn(
				"text-muted-foreground flex items-center gap-2 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
				className,
			)}
		>
			{children}
		</span>
	);
}

function InputGroupInput({
	"aria-invalid": ariaInvalid,
	"aria-label": ariaLabel,
	"aria-labelledby": ariaLabelledBy,
	autoComplete,
	className,
	disabled,
	id,
	min,
	name,
	onBlur,
	onChange,
	placeholder,
	required,
	step,
	type,
	value,
}: React.ComponentProps<typeof Input>) {
	return (
		<Input
			id={id}
			type={type}
			name={name}
			value={value}
			min={min}
			step={step}
			placeholder={placeholder}
			autoComplete={autoComplete}
			required={required}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			aria-label={ariaLabel}
			aria-labelledby={ariaLabelledBy}
			data-slot="input-group-control"
			onBlur={onBlur}
			onChange={onChange}
			className={cn(
				"flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
				className,
			)}
		/>
	);
}

function InputGroupTextarea({
	"aria-invalid": ariaInvalid,
	className,
	disabled,
	id,
	name,
	onBlur,
	onChange,
	placeholder,
	required,
	value,
}: React.ComponentProps<typeof Textarea>) {
	return (
		<Textarea
			id={id}
			name={name}
			value={value}
			placeholder={placeholder}
			required={required}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			data-slot="input-group-control"
			onBlur={onBlur}
			onChange={onChange}
			className={cn(
				"flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none focus-visible:ring-0 dark:bg-transparent",
				className,
			)}
		/>
	);
}

export {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
	InputGroupText,
	InputGroupTextarea,
};
