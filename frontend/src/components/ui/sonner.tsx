"use client";

import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({
	closeButton,
	dir,
	duration,
	expand,
	invert,
	offset,
	position,
	richColors,
	visibleToasts,
}: ToasterProps) => {
	const { theme = "system" } = useTheme();

	return (
		<Sonner
			closeButton={closeButton}
			dir={dir}
			duration={duration}
			expand={expand}
			invert={invert}
			offset={offset}
			position={position}
			richColors={richColors}
			theme={theme as ToasterProps["theme"]}
			visibleToasts={visibleToasts}
			className="toaster group"
			icons={{
				success: <CircleCheck className="h-4 w-4" />,
				info: <Info className="h-4 w-4" />,
				warning: <TriangleAlert className="h-4 w-4" />,
				error: <OctagonX className="h-4 w-4" />,
				loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
			}}
			toastOptions={{
				classNames: {
					toast:
						"group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
					description: "group-[.toast]:text-muted-foreground",
					actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
					cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
				},
			}}
		/>
	);
};

export { Toaster };
