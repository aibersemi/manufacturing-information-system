"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import * as m from "@/paraglide/messages";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarDivProps = Pick<React.ComponentProps<"div">, "children" | "className" | "id" | "style">;
type SidebarButtonProps = Pick<
	React.ComponentProps<"button">,
	"aria-label" | "children" | "className" | "disabled" | "id" | "onClick" | "title" | "type"
>;
type SidebarListProps = Pick<React.ComponentProps<"ul">, "children" | "className" | "id">;
type SidebarListItemProps = Pick<React.ComponentProps<"li">, "children" | "className" | "id">;
type SidebarLinkProps = Pick<
	React.ComponentProps<"a">,
	"aria-current" | "children" | "className" | "href" | "id" | "onClick" | "rel" | "target"
>;

type SidebarContextProps = {
	state: "expanded" | "collapsed";
	open: boolean;
	setOpen: (open: boolean) => void;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	isMobile: boolean;
	toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) {
		throw new Error("useSidebar must be used within a SidebarProvider.");
	}

	return context;
}

const SidebarProvider = React.forwardRef<
	HTMLDivElement,
	SidebarDivProps & {
		defaultOpen?: boolean;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	}
>(
	(
		{
			defaultOpen = true,
			open: openProp,
			onOpenChange: setOpenProp,
			className,
			style,
			children,
			id,
		},
		ref,
	) => {
		const isMobile = useIsMobile();
		const [openMobile, setOpenMobile] = React.useState(false);

		// State internal sidebar; openProp dan setOpenProp dipakai untuk kontrol dari luar.
		const [_open, _setOpen] = React.useState(defaultOpen);
		const open = openProp ?? _open;
		const setOpen = React.useCallback(
			(value: boolean | ((value: boolean) => boolean)) => {
				const openState = typeof value === "function" ? value(open) : value;
				if (setOpenProp) {
					setOpenProp(openState);
				} else {
					_setOpen(openState);
				}

				// biome-ignore lint/suspicious/noDocumentCookie: Cookie UI non-auth ini hanya menyimpan status sidebar.
				document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
			},
			[setOpenProp, open],
		);

		// Helper untuk toggle sidebar.
		const toggleSidebar = React.useCallback(() => {
			return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
		}, [isMobile, setOpen, setOpenMobile]);

		// Menambahkan shortcut keyboard untuk toggle sidebar.
		React.useEffect(() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					toggleSidebar();
				}
			};

			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}, [toggleSidebar]);

		// State ini membuat data-state="expanded" atau "collapsed" mudah ditargetkan Tailwind.
		const state = open ? "expanded" : "collapsed";

		const contextValue = React.useMemo<SidebarContextProps>(
			() => ({
				state,
				open,
				setOpen,
				isMobile,
				openMobile,
				setOpenMobile,
				toggleSidebar,
			}),
			[state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
		);

		return (
			<SidebarContext.Provider value={contextValue}>
				<TooltipProvider delayDuration={0}>
					<div
						id={id}
						style={
							{
								"--sidebar-width": SIDEBAR_WIDTH,
								"--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
								...style,
							} as React.CSSProperties
						}
						className={cn(
							"group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar",
							className,
						)}
						ref={ref}
					>
						{children}
					</div>
				</TooltipProvider>
			</SidebarContext.Provider>
		);
	},
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<
	HTMLDivElement,
	SidebarDivProps & {
		side?: "left" | "right";
		variant?: "sidebar" | "floating" | "inset";
		collapsible?: "offcanvas" | "icon" | "none";
	}
>(
	(
		{
			side = "left",
			variant = "sidebar",
			collapsible = "offcanvas",
			className,
			children,
			id,
			style,
		},
		ref,
	) => {
		const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

		if (collapsible === "none") {
			return (
				<div
					id={id}
					style={style}
					className={cn(
						"flex h-full w-[var(--sidebar-width)] flex-col bg-sidebar text-sidebar-foreground",
						className,
					)}
					ref={ref}
				>
					{children}
				</div>
			);
		}

		if (isMobile) {
			return (
				<Sheet open={openMobile} onOpenChange={setOpenMobile}>
					<SheetContent
						data-sidebar="sidebar"
						data-mobile="true"
						className="w-[var(--sidebar-width)] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
						style={
							{
								"--sidebar-width": SIDEBAR_WIDTH_MOBILE,
							} as React.CSSProperties
						}
						side={side}
					>
						<SheetHeader className="sr-only">
							<SheetTitle>{m.ui_sidebar_title()}</SheetTitle>
							<SheetDescription>{m.ui_sidebar_description()}</SheetDescription>
						</SheetHeader>
						<div className="flex h-full w-full flex-col">{children}</div>
					</SheetContent>
				</Sheet>
			);
		}

		return (
			<div
				ref={ref}
				className="group peer hidden text-sidebar-foreground md:block"
				data-state={state}
				data-collapsible={state === "collapsed" ? collapsible : ""}
				data-variant={variant}
				data-side={side}
			>
				{/* Elemen ini mengatur jarak sidebar pada desktop */}
				<div
					className={cn(
						"relative w-[var(--sidebar-width)] bg-transparent transition-[width] duration-200 ease-linear",
						"group-data-[collapsible=offcanvas]:w-0",
						"group-data-[side=right]:rotate-180",
						variant === "floating" || variant === "inset"
							? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4))]"
							: "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)]",
					)}
				/>
				<div
					id={id}
					style={style}
					className={cn(
						"fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex",
						side === "left"
							? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
							: "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
						// Sesuaikan padding untuk varian floating dan inset.
						variant === "floating" || variant === "inset"
							? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)_+_theme(spacing.4)_+2px)]"
							: "group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)] group-data-[side=left]:border-r group-data-[side=right]:border-l",
						className,
					)}
				>
					<div
						data-sidebar="sidebar"
						className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow"
					>
						{children}
					</div>
				</div>
			</div>
		);
	},
);
Sidebar.displayName = "Sidebar";

const SidebarTrigger = React.forwardRef<
	React.ElementRef<typeof Button>,
	React.ComponentProps<typeof Button>
>(
	(
		{
			"aria-label": ariaLabel,
			"aria-labelledby": ariaLabelledBy,
			className,
			disabled,
			id,
			onClick,
			type,
		},
		ref,
	) => {
		const { toggleSidebar } = useSidebar();

		return (
			<Button
				ref={ref}
				id={id}
				type={type}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledBy}
				data-sidebar="trigger"
				variant="ghost"
				size="icon"
				className={cn("h-7 w-7", className)}
				onClick={(event) => {
					onClick?.(event);
					toggleSidebar();
				}}
			>
				<PanelLeft />
				<span className="sr-only">{m.ui_toggle_sidebar()}</span>
			</Button>
		);
	},
);
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarRail = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
	({ "aria-label": ariaLabel, children, className, disabled, id, onClick, title, type }, ref) => {
		const { toggleSidebar } = useSidebar();

		return (
			<button
				ref={ref}
				id={id}
				type={type}
				data-sidebar="rail"
				aria-label={ariaLabel ?? m.ui_toggle_sidebar()}
				tabIndex={-1}
				disabled={disabled}
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented) {
						toggleSidebar();
					}
				}}
				title={title ?? m.ui_toggle_sidebar()}
				className={cn(
					"absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex",
					"[[data-side=left]_&]:cursor-w-resize [[data-side=right]_&]:cursor-e-resize",
					"[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
					"group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar",
					"[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
					"[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
					className,
				)}
			>
				{children}
			</button>
		);
	},
);
SidebarRail.displayName = "SidebarRail";

type SidebarMainProps = Pick<React.ComponentProps<"main">, "children" | "className" | "id">;

const SidebarInset = React.forwardRef<HTMLDivElement, SidebarMainProps>(
	({ children, className, id }, ref) => {
		return (
			<main
				ref={ref}
				id={id}
				className={cn(
					"relative flex w-full flex-1 flex-col bg-background",
					"md:peer-data-[variant=inset]:m-2 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow",
					className,
				)}
			>
				{children}
			</main>
		);
	},
);
SidebarInset.displayName = "SidebarInset";

const SidebarInput = React.forwardRef<
	React.ElementRef<typeof Input>,
	React.ComponentProps<typeof Input>
>(
	(
		{
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
		},
		ref,
	) => {
		return (
			<Input
				ref={ref}
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
				data-sidebar="input"
				onBlur={onBlur}
				onChange={onChange}
				className={cn(
					"h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
					className,
				)}
			/>
		);
	},
);
SidebarInput.displayName = "SidebarInput";

const SidebarHeader = React.forwardRef<HTMLDivElement, SidebarDivProps>(
	({ children, className, id, style }, ref) => {
		return (
			<div
				ref={ref}
				id={id}
				data-sidebar="header"
				style={style}
				className={cn("flex flex-col gap-2 p-2", className)}
			>
				{children}
			</div>
		);
	},
);
SidebarHeader.displayName = "SidebarHeader";

const SidebarFooter = React.forwardRef<HTMLDivElement, SidebarDivProps>(
	({ children, className, id, style }, ref) => {
		return (
			<div
				ref={ref}
				id={id}
				data-sidebar="footer"
				style={style}
				className={cn("flex flex-col gap-2 p-2", className)}
			>
				{children}
			</div>
		);
	},
);
SidebarFooter.displayName = "SidebarFooter";

const SidebarSeparator = React.forwardRef<
	React.ElementRef<typeof Separator>,
	React.ComponentProps<typeof Separator>
>(({ className, decorative, id, orientation }, ref) => {
	return (
		<Separator
			ref={ref}
			id={id}
			decorative={decorative}
			orientation={orientation}
			data-sidebar="separator"
			className={cn("mx-2 w-auto bg-sidebar-border", className)}
		/>
	);
});
SidebarSeparator.displayName = "SidebarSeparator";

const SidebarContent = React.forwardRef<HTMLDivElement, SidebarDivProps>(
	({ children, className, id, style }, ref) => {
		return (
			<div
				ref={ref}
				id={id}
				data-sidebar="content"
				style={style}
				className={cn(
					"flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
					className,
				)}
			>
				{children}
			</div>
		);
	},
);
SidebarContent.displayName = "SidebarContent";

const SidebarGroup = React.forwardRef<HTMLDivElement, SidebarDivProps>(
	({ children, className, id, style }, ref) => {
		return (
			<div
				ref={ref}
				id={id}
				data-sidebar="group"
				style={style}
				className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
			>
				{children}
			</div>
		);
	},
);
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, SidebarDivProps & { asChild?: boolean }>(
	({ asChild = false, children, className, id, style }, ref) => {
		const Comp = asChild ? Slot : "div";

		return (
			<Comp
				ref={ref}
				id={id}
				data-sidebar="group-label"
				style={style}
				className={cn(
					"flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
					"group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
					className,
				)}
			>
				{children}
			</Comp>
		);
	},
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarGroupAction = React.forwardRef<
	HTMLButtonElement,
	SidebarButtonProps & { asChild?: boolean }
>(
	(
		{
			"aria-label": ariaLabel,
			asChild = false,
			children,
			className,
			disabled,
			id,
			onClick,
			title,
			type,
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "button";

		return (
			<Comp
				ref={ref}
				id={id}
				type={type}
				disabled={disabled}
				aria-label={ariaLabel}
				title={title}
				data-sidebar="group-action"
				onClick={onClick}
				className={cn(
					"absolute right-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
					// Memperbesar area sentuh tombol pada mobile.
					"after:absolute after:-inset-2 after:md:hidden",
					"group-data-[collapsible=icon]:hidden",
					className,
				)}
			>
				{children}
			</Comp>
		);
	},
);
SidebarGroupAction.displayName = "SidebarGroupAction";

const SidebarGroupContent = React.forwardRef<HTMLDivElement, SidebarDivProps>(
	({ children, className, id, style }, ref) => (
		<div
			ref={ref}
			id={id}
			data-sidebar="group-content"
			style={style}
			className={cn("w-full text-sm", className)}
		>
			{children}
		</div>
	),
);
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = React.forwardRef<HTMLUListElement, SidebarListProps>(
	({ children, className, id }, ref) => (
		<ul
			ref={ref}
			id={id}
			data-sidebar="menu"
			className={cn("flex w-full min-w-0 flex-col gap-1", className)}
		>
			{children}
		</ul>
	),
);
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<HTMLLIElement, SidebarListItemProps>(
	({ children, className, id }, ref) => (
		<li
			ref={ref}
			id={id}
			data-sidebar="menu-item"
			className={cn("group/menu-item relative", className)}
		>
			{children}
		</li>
	),
);
SidebarMenuItem.displayName = "SidebarMenuItem";

const sidebarMenuButtonVariants = cva(
	"peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
				outline:
					"bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
			},
			size: {
				default: "h-8 text-sm",
				sm: "h-7 text-xs",
				lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

const SidebarMenuButton = React.forwardRef<
	HTMLButtonElement,
	SidebarButtonProps & {
		asChild?: boolean;
		isActive?: boolean;
		tooltip?: string | React.ComponentProps<typeof TooltipContent>;
	} & VariantProps<typeof sidebarMenuButtonVariants>
>(
	(
		{
			"aria-label": ariaLabel,
			asChild = false,
			children,
			disabled,
			id,
			isActive = false,
			onClick,
			title,
			type,
			variant = "default",
			size = "default",
			tooltip,
			className,
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "button";
		const { isMobile, state } = useSidebar();

		const button = (
			<Comp
				ref={ref}
				id={id}
				type={type}
				disabled={disabled}
				aria-label={ariaLabel}
				title={title}
				data-sidebar="menu-button"
				data-size={size}
				data-active={isActive}
				onClick={onClick}
				className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
			>
				{children}
			</Comp>
		);

		if (!tooltip) {
			return button;
		}

		if (typeof tooltip === "string") {
			tooltip = {
				children: tooltip,
			};
		}

		const {
			align,
			avoidCollisions,
			children: tooltipChildren,
			className: tooltipClassName,
			collisionPadding,
			forceMount,
			id: tooltipId,
			side,
			sideOffset,
		} = tooltip;

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent
					id={tooltipId}
					side={side ?? "right"}
					align={align ?? "center"}
					sideOffset={sideOffset}
					avoidCollisions={avoidCollisions}
					collisionPadding={collisionPadding}
					forceMount={forceMount}
					hidden={state !== "collapsed" || isMobile}
					className={tooltipClassName}
				>
					{tooltipChildren}
				</TooltipContent>
			</Tooltip>
		);
	},
);
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuAction = React.forwardRef<
	HTMLButtonElement,
	SidebarButtonProps & {
		asChild?: boolean;
		showOnHover?: boolean;
	}
>(
	(
		{
			"aria-label": ariaLabel,
			asChild = false,
			children,
			className,
			disabled,
			id,
			onClick,
			showOnHover = false,
			title,
			type,
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "button";

		return (
			<Comp
				ref={ref}
				id={id}
				type={type}
				disabled={disabled}
				aria-label={ariaLabel}
				title={title}
				data-sidebar="menu-action"
				onClick={onClick}
				className={cn(
					"absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
					// Memperbesar area sentuh tombol pada mobile.
					"after:absolute after:-inset-2 after:md:hidden",
					"peer-data-[size=sm]/menu-button:top-1",
					"peer-data-[size=default]/menu-button:top-1.5",
					"peer-data-[size=lg]/menu-button:top-2.5",
					"group-data-[collapsible=icon]:hidden",
					showOnHover &&
						"group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
					className,
				)}
			>
				{children}
			</Comp>
		);
	},
);
SidebarMenuAction.displayName = "SidebarMenuAction";

const SidebarMenuBadge = React.forwardRef<HTMLDivElement, SidebarDivProps>(
	({ children, className, id, style }, ref) => (
		<div
			ref={ref}
			id={id}
			data-sidebar="menu-badge"
			style={style}
			className={cn(
				"pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground",
				"peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
				"peer-data-[size=sm]/menu-button:top-1",
				"peer-data-[size=default]/menu-button:top-1.5",
				"peer-data-[size=lg]/menu-button:top-2.5",
				"group-data-[collapsible=icon]:hidden",
				className,
			)}
		>
			{children}
		</div>
	),
);
SidebarMenuBadge.displayName = "SidebarMenuBadge";

const SidebarMenuSkeleton = React.forwardRef<
	HTMLDivElement,
	SidebarDivProps & {
		showIcon?: boolean;
	}
>(({ children, className, id, showIcon = false, style }, ref) => {
	// Lebar acak antara 50 sampai 90%.
	const width = React.useMemo(() => {
		return `${Math.floor(Math.random() * 40) + 50}%`;
	}, []);

	return (
		<div
			ref={ref}
			id={id}
			data-sidebar="menu-skeleton"
			style={style}
			className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
		>
			{children}
			{showIcon && <Skeleton className="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />}
			<Skeleton
				className="h-4 max-w-[var(--skeleton-width)] flex-1"
				data-sidebar="menu-skeleton-text"
				style={
					{
						"--skeleton-width": width,
					} as React.CSSProperties
				}
			/>
		</div>
	);
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

const SidebarMenuSub = React.forwardRef<HTMLUListElement, SidebarListProps>(
	({ children, className, id }, ref) => (
		<ul
			ref={ref}
			id={id}
			data-sidebar="menu-sub"
			className={cn(
				"mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
				"group-data-[collapsible=icon]:hidden",
				className,
			)}
		>
			{children}
		</ul>
	),
);
SidebarMenuSub.displayName = "SidebarMenuSub";

const SidebarMenuSubItem = React.forwardRef<HTMLLIElement, SidebarListItemProps>(
	({ children, className, id }, ref) => (
		<li ref={ref} id={id} className={className}>
			{children}
		</li>
	),
);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

const SidebarMenuSubButton = React.forwardRef<
	HTMLAnchorElement,
	SidebarLinkProps & {
		asChild?: boolean;
		size?: "sm" | "md";
		isActive?: boolean;
	}
>(
	(
		{
			"aria-current": ariaCurrent,
			asChild = false,
			children,
			className,
			href,
			id,
			isActive,
			onClick,
			rel,
			size = "md",
			target,
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "a";

		return (
			<Comp
				ref={ref}
				id={id}
				href={href}
				target={target}
				rel={rel}
				aria-current={ariaCurrent}
				data-sidebar="menu-sub-button"
				data-size={size}
				data-active={isActive}
				onClick={onClick}
				className={cn(
					"flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
					"data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
					size === "sm" && "text-xs",
					size === "md" && "text-sm",
					"group-data-[collapsible=icon]:hidden",
					className,
				)}
			>
				{children}
			</Comp>
		);
	},
);
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
};
