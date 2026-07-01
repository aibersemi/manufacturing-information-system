import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { formatNumberId } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Format: { NAMA_TEMA: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;
const CSS_VARIABLE_NAME_PART = /^[a-zA-Z0-9_-]+$/;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

type ChartConfigItem = {
	label?: React.ReactNode;
	icon?: React.ComponentType;
} & (
	| { color?: string; theme?: never }
	| { color?: never; theme: Record<keyof typeof THEMES, string> }
);

type UnknownRecord = Record<string, unknown>;

export type ChartConfig = Record<string, ChartConfigItem>;

type ChartContextProps = {
	config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
	const context = React.useContext(ChartContext);

	if (!context) {
		throw new Error("useChart must be used within a <ChartContainer />");
	}

	return context;
}

function formatTooltipValue(value: unknown): string {
	if (Array.isArray(value)) {
		return value.map((item) => formatTooltipValue(item)).join(" - ");
	}
	if (typeof value === "number" || typeof value === "string") {
		return formatNumberId(value);
	}
	return "";
}

const ChartContainer = React.forwardRef<
	HTMLDivElement,
	Pick<React.ComponentProps<"div">, "className" | "id" | "style"> & {
		config: ChartConfig;
		children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
	}
>(({ id, className, children, config, style }, ref) => {
	const uniqueId = React.useId();
	const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;
	const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
	const chartTheme = useChartTheme(container);
	const chartColorVariables = React.useMemo(
		() => getChartColorVariables(config, chartTheme),
		[config, chartTheme],
	);
	const chartStyle = React.useMemo(
		() => Object.assign({}, chartColorVariables, style),
		[chartColorVariables, style],
	);
	const setChartContainerRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			setContainer(node);

			if (typeof ref === "function") {
				ref(node);
				return;
			}

			if (ref) {
				(ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
			}
		},
		[ref],
	);

	return (
		<ChartContext.Provider value={{ config }}>
			<div
				data-chart={chartId}
				ref={setChartContainerRef}
				id={id}
				style={chartStyle}
				className={cn(
					"flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
					className,
				)}
			>
				<RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
			</div>
		</ChartContext.Provider>
	);
});
ChartContainer.displayName = "Chart";

const ChartStyle = (_props: { id: string; config: ChartConfig }) => null;

function useChartTheme(container: HTMLDivElement | null): keyof typeof THEMES {
	const [theme, setTheme] = React.useState<keyof typeof THEMES>("light");

	useIsomorphicLayoutEffect(() => {
		if (!container || typeof MutationObserver === "undefined") {
			return;
		}

		const updateTheme = () => {
			setTheme(container.closest(THEMES.dark) ? "dark" : "light");
		};
		const observer = new MutationObserver(updateTheme);

		updateTheme();

		for (let element: HTMLElement | null = container; element; element = element.parentElement) {
			observer.observe(element, { attributes: true, attributeFilter: ["class"] });
		}

		return () => observer.disconnect();
	}, [container]);

	return theme;
}

function getChartColorVariables(
	config: ChartConfig,
	theme: keyof typeof THEMES,
): React.CSSProperties {
	const colorVariables: React.CSSProperties & Record<`--color-${string}`, string> = {};

	for (const [key, itemConfig] of Object.entries(config)) {
		// Nama key menjadi bagian dari CSS custom property, jadi batasi ke karakter aman.
		if (!CSS_VARIABLE_NAME_PART.test(key) || !isSafeObjectKey(key)) {
			continue;
		}

		const color = getChartThemeColor(itemConfig, theme);

		if (color) {
			Object.defineProperty(colorVariables, `--color-${key}`, {
				value: color,
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
	}

	return colorVariables;
}

function getChartThemeColor(itemConfig: ChartConfigItem, theme: keyof typeof THEMES) {
	if (!itemConfig.theme) {
		return itemConfig.color;
	}

	return theme === "dark" ? itemConfig.theme.dark : itemConfig.theme.light;
}

const ChartTooltip = RechartsPrimitive.Tooltip;

const ChartTooltipContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
		React.ComponentProps<"div"> & {
			hideLabel?: boolean;
			hideIndicator?: boolean;
			indicator?: "line" | "dot" | "dashed";
			nameKey?: string;
			labelKey?: string;
		}
>(
	(
		{
			active,
			payload,
			className,
			indicator = "dot",
			hideLabel = false,
			hideIndicator = false,
			label,
			labelFormatter,
			labelClassName,
			formatter,
			color,
			nameKey,
			labelKey,
		},
		ref,
	) => {
		const { config } = useChart();

		const tooltipLabel = React.useMemo(() => {
			if (hideLabel || !payload?.length) {
				return null;
			}

			const [item] = payload;
			const key = `${labelKey || item?.dataKey || item?.name || "value"}`;
			const itemConfig = getPayloadConfigFromPayload(config, item, key);
			const labelConfig = typeof label === "string" ? getChartConfigItem(config, label) : undefined;
			const value =
				!labelKey && typeof label === "string" ? labelConfig?.label || label : itemConfig?.label;

			if (labelFormatter) {
				return (
					<div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
				);
			}

			if (!value) {
				return null;
			}

			return <div className={cn("font-medium", labelClassName)}>{value}</div>;
		}, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

		if (!active || !payload?.length) {
			return null;
		}

		const nestLabel = payload.length === 1 && indicator !== "dot";

		return (
			<div
				ref={ref}
				className={cn(
					"grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
					className,
				)}
			>
				{!nestLabel ? tooltipLabel : null}
				<div className="grid gap-1.5">
					{payload
						.filter((item) => item.type !== "none")
						.map((item, index) => {
							const key = `${nameKey || item.name || item.dataKey || "value"}`;
							const itemConfig = getPayloadConfigFromPayload(config, item, key);
							const indicatorColor = color || item.payload.fill || item.color;

							return (
								<div
									key={item.dataKey}
									className={cn(
										"flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
										indicator === "dot" && "items-center",
									)}
								>
									{formatter && item?.value !== undefined && item.name ? (
										formatter(item.value, item.name, item, index, item.payload)
									) : (
										<>
											{itemConfig?.icon ? (
												<itemConfig.icon />
											) : (
												!hideIndicator && (
													<div
														className={cn(
															"shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]",
															{
																"h-2.5 w-2.5": indicator === "dot",
																"w-1": indicator === "line",
																"w-0 border-[1.5px] border-dashed bg-transparent":
																	indicator === "dashed",
																"my-0.5": nestLabel && indicator === "dashed",
															},
														)}
														style={
															{
																"--color-bg": indicatorColor,
																"--color-border": indicatorColor,
															} as React.CSSProperties
														}
													/>
												)
											)}
											<div
												className={cn(
													"flex flex-1 justify-between leading-none",
													nestLabel ? "items-end" : "items-center",
												)}
											>
												<div className="grid gap-1.5">
													{nestLabel ? tooltipLabel : null}
													<span className="text-muted-foreground">
														{itemConfig?.label || item.name}
													</span>
												</div>
												{item.value && (
													<span className="font-mono font-medium tabular-nums text-foreground">
														{formatTooltipValue(item.value)}
													</span>
												)}
											</div>
										</>
									)}
								</div>
							);
						})}
				</div>
			</div>
		);
	},
);
ChartTooltipContent.displayName = "ChartTooltip";

const ChartLegend = RechartsPrimitive.Legend;

const ChartLegendContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div"> &
		Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
			hideIcon?: boolean;
			nameKey?: string;
		}
>(({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }, ref) => {
	const { config } = useChart();

	if (!payload?.length) {
		return null;
	}

	return (
		<div
			ref={ref}
			className={cn(
				"flex items-center justify-center gap-4",
				verticalAlign === "top" ? "pb-3" : "pt-3",
				className,
			)}
		>
			{payload
				.filter((item) => item.type !== "none")
				.map((item) => {
					const key = `${nameKey || item.dataKey || "value"}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);

					return (
						<div
							key={item.value}
							className={cn(
								"flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground",
							)}
						>
							{itemConfig?.icon && !hideIcon ? (
								<itemConfig.icon />
							) : (
								<div
									className="h-2 w-2 shrink-0 rounded-[2px]"
									style={{
										backgroundColor: item.color,
									}}
								/>
							)}
							{itemConfig?.label}
						</div>
					);
				})}
		</div>
	);
});
ChartLegendContent.displayName = "ChartLegend";

// Helper untuk mengambil konfigurasi item dari payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
	if (!isRecord(payload)) {
		return undefined;
	}

	const nestedPayload = getOwnProperty(payload, "payload");
	const payloadPayload = isRecord(nestedPayload) ? nestedPayload : undefined;

	const configLabelKey =
		getOwnStringProperty(payload, key) ?? getOwnStringProperty(payloadPayload, key) ?? key;

	return getChartConfigItem(config, configLabelKey) ?? getChartConfigItem(config, key);
}

function getChartConfigItem(config: ChartConfig, key: string) {
	const itemConfig = getOwnProperty(config, key);

	return isChartConfigItem(itemConfig) ? itemConfig : undefined;
}

function getOwnStringProperty(record: UnknownRecord | undefined, key: string) {
	const value = record ? getOwnProperty(record, key) : undefined;

	return typeof value === "string" ? value : undefined;
}

function getOwnProperty(record: UnknownRecord, key: string) {
	if (!isSafeObjectKey(key)) {
		return undefined;
	}

	return Object.getOwnPropertyDescriptor(record, key)?.value;
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null;
}

function isChartConfigItem(value: unknown): value is ChartConfigItem {
	return isRecord(value);
}

function isSafeObjectKey(key: string) {
	return key.length > 0 && !UNSAFE_OBJECT_KEYS.has(key);
}

export {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartStyle,
	ChartTooltip,
	ChartTooltipContent,
};
