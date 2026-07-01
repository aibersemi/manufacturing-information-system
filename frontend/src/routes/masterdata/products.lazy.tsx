import { useForm } from "@tanstack/react-form";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Store, useStore } from "@tanstack/react-store";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAuthGetCapabilities } from "@/api/generated/auth/auth";
import {
	useBackendApiMasterdataCreateProduct,
	useBackendApiMasterdataCreateProductVariant,
	useBackendApiMasterdataDeleteProduct,
	useBackendApiMasterdataDeleteProductVariant,
	useBackendApiMasterdataListProducts,
	useBackendApiMasterdataListProductVariants,
	useBackendApiMasterdataUpdateProduct,
	useBackendApiMasterdataUpdateProductVariant,
} from "@/api/generated/master-data/master-data";
import type { ProductModelPayload } from "@/api/generated/models/productModelPayload";
import type { ProductModelResponse } from "@/api/generated/models/productModelResponse";
import type { ProductVariantPayload } from "@/api/generated/models/productVariantPayload";
import type { ProductVariantResponse } from "@/api/generated/models/productVariantResponse";
import { AccessGuard } from "@/components/access-guard";
import { DataEmpty, DataLoading } from "@/components/data-states";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/capabilities";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";
import { productsRoute } from "./products";

type DeleteTarget =
	| { type: "model"; item: ProductModelResponse }
	| { type: "variant"; item: ProductVariantResponse };

export function ProductsRouteScreen() {
	return (
		<AccessGuard anyOf={["masterdata.products.read", "masterdata.product_variants.read"]}>
			<ProductsScreen />
		</AccessGuard>
	);
}

const productModelFormSchema = z.object({
	code: z.string().trim().min(1, m.products_model_code_required()),
	name: z.string().trim().min(1, m.products_model_name_required()),
	description: z.string().trim(),
	status: z.enum(["active", "inactive"]),
});

const productVariantFormSchema = z.object({
	product_model_id: z.string().trim().min(1, m.products_model_required()),
	color: z.string().trim(),
	size: z.string().trim(),
	status: z.enum(["active", "inactive"]),
});

const SKU_SEGMENT_PATTERN = /^[A-Z0-9_]+$/;

function normalizeSkuPreviewSegment(value: string, defaultZero = false) {
	const segment = value.trim().toUpperCase().replace(/\s+/g, "_");
	if (!segment) return defaultZero ? "0" : "";
	if (segment.includes("-") || !SKU_SEGMENT_PATTERN.test(segment)) return "";
	return segment;
}

function buildProductVariantSkuPreview(productCode: string, color: string, size: string) {
	const modelSegment = normalizeSkuPreviewSegment(productCode);
	const colorSegment = normalizeSkuPreviewSegment(color, true);
	const sizeSegment = normalizeSkuPreviewSegment(size, true);
	if (!modelSegment || !colorSegment || !sizeSegment) return "";
	const sku = `${modelSegment}-${colorSegment}-${sizeSegment}`;
	return sku.length <= 100 ? sku : "";
}

function optionalString(value: string): string | undefined {
	return value || undefined;
}

function toProductModelPayload(value: unknown): ProductModelPayload {
	const parsed = productModelFormSchema.parse(value);
	return {
		code: parsed.code,
		name: parsed.name,
		description: optionalString(parsed.description),
		is_active: parsed.status === "active",
	};
}

function toProductVariantPayload(
	value: unknown,
	selectedVariant: ProductVariantResponse | null,
): ProductVariantPayload {
	const parsed = productVariantFormSchema.parse(value);
	return {
		product_model_id: parsed.product_model_id,
		color: optionalString(parsed.color),
		size: optionalString(parsed.size),
		metadata: selectedVariant?.metadata ?? {},
		default_margin_percent: selectedVariant?.default_margin_percent ?? undefined,
		is_active: parsed.status === "active",
	};
}

function ProductsScreen() {
	const search = useSearch({ from: productsRoute.id });
	const navigate = useNavigate({ from: productsRoute.id });
	const uiStore = useMemo(
		() =>
			new Store({
				selectedModel: null as ProductModelResponse | null,
				selectedVariant: null as ProductVariantResponse | null,
				deleteTarget: null as DeleteTarget | null,
			}),
		[],
	);
	const ui = useStore(uiStore);
	const { selectedModel, selectedVariant, deleteTarget } = ui;
	const setUi = (patch: Partial<typeof ui>) =>
		uiStore.setState((state) => ({ ...state, ...patch }));
	const capabilities = useBackendApiAuthGetCapabilities();
	const capabilityList =
		capabilities.data?.status === 200 ? capabilities.data.data.capabilities : undefined;
	const canCreateProduct = can(capabilityList, "masterdata.products.create");
	const canUpdateProduct = can(capabilityList, "masterdata.products.update");
	const canDeleteProduct = can(capabilityList, "masterdata.products.delete");
	const canCreateVariant = can(capabilityList, "masterdata.product_variants.create");
	const canUpdateVariant = can(capabilityList, "masterdata.product_variants.update");
	const canDeleteVariant = can(capabilityList, "masterdata.product_variants.delete");
	const {
		data: response,
		isLoading,
		refetch: refetchProducts,
	} = useBackendApiMasterdataListProducts();
	const products = response?.data || [];
	const {
		data: variantsResponse,
		isLoading: isVariantsLoading,
		refetch: refetchVariants,
	} = useBackendApiMasterdataListProductVariants();
	const variants = variantsResponse?.data || [];
	const productsById = useMemo(() => {
		const indexed = new Map<string, ProductModelResponse>();
		for (const product of products) {
			indexed.set(product.id, product);
		}
		return indexed;
	}, [products]);
	const variantsByProduct = useMemo(() => {
		const grouped = new Map<string, ProductVariantResponse[]>();
		for (const variant of variants) {
			const productVariants = grouped.get(variant.product_model_id) || [];
			productVariants.push(variant);
			grouped.set(variant.product_model_id, productVariants);
		}
		return grouped;
	}, [variants]);
	const createModelMutation = useBackendApiMasterdataCreateProduct();
	const updateModelMutation = useBackendApiMasterdataUpdateProduct();
	const deleteModelMutation = useBackendApiMasterdataDeleteProduct();
	const createVariantMutation = useBackendApiMasterdataCreateProductVariant();
	const updateVariantMutation = useBackendApiMasterdataUpdateProductVariant();
	const deleteVariantMutation = useBackendApiMasterdataDeleteProductVariant();
	const isModelFormOpen =
		(canCreateProduct && search.action === "create-model") ||
		(canUpdateProduct && Boolean(selectedModel));
	const isVariantFormOpen =
		(canCreateVariant && search.action === "create-variant") ||
		(canUpdateVariant && Boolean(selectedVariant));
	const closeModelForm = () => {
		setUi({ selectedModel: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined }) });
		modelForm.reset();
	};
	const closeVariantForm = () => {
		setUi({ selectedVariant: null });
		navigate({ search: (previous) => ({ ...previous, action: undefined, modelId: undefined }) });
		variantForm.reset();
	};
	const modelForm = useForm({
		defaultValues: {
			code: "",
			name: "",
			description: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: productModelFormSchema,
			onSubmit: productModelFormSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toProductModelPayload(value);
				if (selectedModel) {
					await updateModelMutation.mutateAsync({ productId: selectedModel.id, data: payload });
				} else {
					await createModelMutation.mutateAsync({ data: payload });
				}
				toast.success(m.common_mutation_success());
				setUi({ selectedModel: null });
				navigate({ search: (previous) => ({ ...previous, action: undefined }) });
				modelForm.reset();
				await refetchProducts();
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});
	const variantForm = useForm({
		defaultValues: {
			product_model_id: search.modelId ?? "",
			color: "",
			size: "",
			status: "active" as "active" | "inactive",
		},
		validators: {
			onChange: productVariantFormSchema,
			onSubmit: productVariantFormSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				const payload = toProductVariantPayload(value, selectedVariant);
				if (selectedVariant) {
					await updateVariantMutation.mutateAsync({
						variantId: selectedVariant.id,
						data: payload,
					});
				} else {
					await createVariantMutation.mutateAsync({ data: payload });
				}
				toast.success(m.common_mutation_success());
				setUi({ selectedVariant: null });
				navigate({
					search: (previous) => ({ ...previous, action: undefined, modelId: undefined }),
				});
				variantForm.reset();
				await refetchVariants();
			} catch (error) {
				toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
			}
		},
	});
	useEffect(() => {
		modelForm.reset(
			selectedModel
				? {
						code: selectedModel.code,
						name: selectedModel.name,
						description: selectedModel.description,
						status: selectedModel.is_active ? "active" : "inactive",
					}
				: {
						code: "",
						name: "",
						description: "",
						status: "active",
					},
		);
	}, [selectedModel, modelForm]);
	useEffect(() => {
		variantForm.reset(
			selectedVariant
				? {
						product_model_id: selectedVariant.product_model_id,
						color: selectedVariant.color,
						size: selectedVariant.size,
						status: selectedVariant.is_active ? "active" : "inactive",
					}
				: {
						product_model_id: search.modelId ?? "",
						color: "",
						size: "",
						status: "active",
					},
		);
	}, [selectedVariant, search.modelId, variantForm]);
	const confirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			if (deleteTarget.type === "model") {
				await deleteModelMutation.mutateAsync({ productId: deleteTarget.item.id });
				setUi({
					selectedModel: selectedModel?.id === deleteTarget.item.id ? null : selectedModel,
					deleteTarget: null,
				});
				await refetchProducts();
				await refetchVariants();
			} else {
				await deleteVariantMutation.mutateAsync({ variantId: deleteTarget.item.id });
				setUi({
					selectedVariant: selectedVariant?.id === deleteTarget.item.id ? null : selectedVariant,
					deleteTarget: null,
				});
				await refetchVariants();
			}
			toast.success(m.common_mutation_success());
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	};
	const isDeleting = deleteModelMutation.isPending || deleteVariantMutation.isPending;

	return (
		<div className="flex flex-col gap-6 p-6 lg:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-bold">{m.products_title()}</h1>
					<p className="text-sm text-muted-foreground">{m.products_description()}</p>
				</div>

				{canCreateProduct || canUpdateProduct ? (
					<Sheet
						open={isModelFormOpen}
						onOpenChange={(open) => {
							if (!open) closeModelForm();
						}}
					>
						{canCreateProduct ? (
							<SheetTrigger asChild>
								<Button
									type="button"
									onClick={() => {
										setUi({ selectedModel: null });
										navigate({ search: (previous) => ({ ...previous, action: "create-model" }) });
									}}
								>
									{m.products_add()}
								</Button>
							</SheetTrigger>
						) : null}
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{selectedModel ? m.common_edit() : m.products_add()}</SheetTitle>
								<SheetDescription>{m.products_add_model_description()}</SheetDescription>
							</SheetHeader>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void modelForm.handleSubmit();
								}}
								className="mt-6"
							>
								<FieldGroup className="gap-4">
									<modelForm.Field name="code">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="product-model-code">{m.common_code()}</FieldLabel>
													<Input
														id="product-model-code"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														aria-invalid={invalid}
														required
													/>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</modelForm.Field>
									<modelForm.Field name="name">
										{(field) => {
											const invalid = field.state.meta.errors.length > 0;
											return (
												<Field data-invalid={invalid}>
													<FieldLabel htmlFor="product-model-name">{m.common_name()}</FieldLabel>
													<Input
														id="product-model-name"
														name={field.name}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														aria-invalid={invalid}
														required
													/>
													<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
												</Field>
											);
										}}
									</modelForm.Field>
									<modelForm.Field name="description">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="product-model-description">
													{m.common_description()}
												</FieldLabel>
												<Textarea
													id="product-model-description"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
												/>
											</Field>
										)}
									</modelForm.Field>
									<modelForm.Field name="status">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="product-model-status">{m.common_status()}</FieldLabel>
												<NativeSelect
													id="product-model-status"
													name={field.name}
													value={field.state.value}
													onChange={(event) =>
														field.handleChange(event.target.value as "active" | "inactive")
													}
													onBlur={field.handleBlur}
													className="w-full"
												>
													<NativeSelectOption value="active">
														{m.common_active()}
													</NativeSelectOption>
													<NativeSelectOption value="inactive">
														{m.common_inactive()}
													</NativeSelectOption>
												</NativeSelect>
											</Field>
										)}
									</modelForm.Field>
									<modelForm.Subscribe selector={(state) => state.isSubmitting}>
										{(isSubmitting) => (
											<div className="flex flex-col gap-2 sm:flex-row">
												<Button
													type="submit"
													disabled={
														isSubmitting ||
														createModelMutation.isPending ||
														updateModelMutation.isPending
													}
												>
													{createModelMutation.isPending || updateModelMutation.isPending ? (
														<>
															<Spinner data-icon="inline-start" />
															{m.common_saving()}
														</>
													) : (
														m.common_save()
													)}
												</Button>
												{selectedModel ? (
													<Button type="button" variant="outline" onClick={closeModelForm}>
														{m.common_cancel()}
													</Button>
												) : null}
											</div>
										)}
									</modelForm.Subscribe>
								</FieldGroup>
							</form>
						</SheetContent>
					</Sheet>
				) : null}
			</div>

			{canCreateVariant || canUpdateVariant ? (
				<Sheet
					open={isVariantFormOpen}
					onOpenChange={(open) => {
						if (!open) closeVariantForm();
					}}
				>
					<SheetContent className="overflow-y-auto">
						<SheetHeader>
							<SheetTitle>
								{selectedVariant ? m.common_edit() : m.products_add_variant()}
							</SheetTitle>
							<SheetDescription>{m.products_add_variant_description()}</SheetDescription>
						</SheetHeader>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void variantForm.handleSubmit();
							}}
							className="mt-6"
						>
							<FieldGroup className="gap-4">
								<variantForm.Field name="product_model_id">
									{(field) => {
										const invalid = field.state.meta.errors.length > 0;
										return (
											<Field data-invalid={invalid}>
												<FieldLabel htmlFor="product-variant-model">
													{m.products_title()}
												</FieldLabel>
												<NativeSelect
													id="product-variant-model"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													aria-invalid={invalid}
													className="w-full"
													required
												>
													<NativeSelectOption value="" disabled>
														{m.products_model_required()}
													</NativeSelectOption>
													{products.map((product) => (
														<NativeSelectOption key={product.id} value={product.id}>
															{product.name} ({product.code})
														</NativeSelectOption>
													))}
												</NativeSelect>
												<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
											</Field>
										);
									}}
								</variantForm.Field>
								<div className="grid gap-4 sm:grid-cols-2">
									<variantForm.Field name="color">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="product-variant-color">
													{m.products_color()}
												</FieldLabel>
												<Input
													id="product-variant-color"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													placeholder={m.products_color_placeholder()}
												/>
											</Field>
										)}
									</variantForm.Field>
									<variantForm.Field name="size">
										{(field) => (
											<Field>
												<FieldLabel htmlFor="product-variant-size">{m.products_size()}</FieldLabel>
												<Input
													id="product-variant-size"
													name={field.name}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													placeholder={m.products_size_placeholder()}
												/>
											</Field>
										)}
									</variantForm.Field>
								</div>
								<variantForm.Subscribe
									selector={(state) => [
										state.values.product_model_id,
										state.values.color,
										state.values.size,
									]}
								>
									{([productModelId, color, size]) => {
										const product = productsById.get(productModelId);
										const skuPreview = product
											? buildProductVariantSkuPreview(product.code, color, size)
											: "";
										return (
											<Field>
												<FieldLabel htmlFor="product-variant-sku">{m.products_sku()}</FieldLabel>
												<Input
													id="product-variant-sku"
													value={skuPreview}
													placeholder={m.products_sku_placeholder()}
													readOnly
													aria-readonly="true"
													className="font-mono"
												/>
											</Field>
										);
									}}
								</variantForm.Subscribe>
								<variantForm.Field name="status">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="product-variant-status">{m.common_status()}</FieldLabel>
											<NativeSelect
												id="product-variant-status"
												name={field.name}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value as "active" | "inactive")
												}
												onBlur={field.handleBlur}
												className="w-full"
											>
												<NativeSelectOption value="active">{m.common_active()}</NativeSelectOption>
												<NativeSelectOption value="inactive">
													{m.common_inactive()}
												</NativeSelectOption>
											</NativeSelect>
										</Field>
									)}
								</variantForm.Field>
								<variantForm.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<div className="flex flex-col gap-2 sm:flex-row">
											<Button
												type="submit"
												disabled={
													isSubmitting ||
													createVariantMutation.isPending ||
													updateVariantMutation.isPending
												}
											>
												{createVariantMutation.isPending || updateVariantMutation.isPending ? (
													<>
														<Spinner data-icon="inline-start" />
														{m.common_saving()}
													</>
												) : (
													m.common_save()
												)}
											</Button>
											{selectedVariant ? (
												<Button type="button" variant="outline" onClick={closeVariantForm}>
													{m.common_cancel()}
												</Button>
											) : null}
										</div>
									)}
								</variantForm.Subscribe>
							</FieldGroup>
						</form>
					</SheetContent>
				</Sheet>
			) : null}

			{isLoading || isVariantsLoading ? (
				<Card>
					<CardContent className="pt-6">
						<DataLoading />
					</CardContent>
				</Card>
			) : products.length ? (
				<div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
					{products.map((product) => {
						const productVariants = variantsByProduct.get(product.id) || [];

						return (
							<Card key={product.id} className="flex flex-col">
								<CardHeader>
									<div className="flex items-start justify-between gap-4">
										<div className="flex min-w-0 flex-col gap-1">
											<CardTitle className="truncate">{product.name}</CardTitle>
											<CardDescription>{m.products_code({ code: product.code })}</CardDescription>
										</div>
										<div className="flex items-center gap-2">
											<Badge variant={product.is_active ? "secondary" : "outline"}>
												{product.is_active ? m.common_active() : m.common_inactive()}
											</Badge>
											<ProductModelActions
												canDelete={canDeleteProduct}
												canUpdate={canUpdateProduct}
												onEdit={() => setUi({ selectedModel: product })}
												onDelete={() => setUi({ deleteTarget: { type: "model", item: product } })}
											/>
										</div>
									</div>
								</CardHeader>
								<CardContent className="flex flex-1 flex-col gap-4">
									<p className="text-sm text-muted-foreground">
										{product.description || m.products_no_description()}
									</p>
									<div className="flex flex-col gap-2">
										<p className="text-sm font-semibold">
											{m.products_variants_count({ count: productVariants.length })}
										</p>
										{productVariants.length > 0 ? (
											<div className="flex flex-col gap-2">
												{productVariants.map((variant) => (
													<div
														key={variant.id}
														className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
													>
														<div className="flex min-w-0 flex-wrap items-center gap-2">
															<span className="font-medium">{variant.sku}</span>
															<Badge variant={variant.is_active ? "secondary" : "outline"}>
																{variant.is_active ? m.common_active() : m.common_inactive()}
															</Badge>
														</div>
														<ProductVariantActions
															canDelete={canDeleteVariant}
															canUpdate={canUpdateVariant}
															onEdit={() => setUi({ selectedVariant: variant })}
															onDelete={() =>
																setUi({ deleteTarget: { type: "variant", item: variant } })
															}
														/>
													</div>
												))}
											</div>
										) : (
											<p className="text-sm text-muted-foreground">{m.products_variants_empty()}</p>
										)}
									</div>
								</CardContent>
								{canCreateVariant ? (
									<CardFooter>
										<Button
											type="button"
											variant="outline"
											className="w-full"
											onClick={() => {
												setUi({ selectedVariant: null });
												navigate({
													search: (previous) => ({
														...previous,
														action: "create-variant",
														modelId: product.id,
													}),
												});
											}}
										>
											{m.products_add_variant_short()}
										</Button>
									</CardFooter>
								) : null}
							</Card>
						);
					})}
				</div>
			) : (
				<DataEmpty title={m.products_empty_title()} description={m.products_empty_description()} />
			)}

			<AlertDialog
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => !open && setUi({ deleteTarget: null })}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{m.settings_delete_title()}</AlertDialogTitle>
						<AlertDialogDescription>
							{m.settings_delete_description({ target: deleteTargetLabel(deleteTarget) })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>{m.common_cancel()}</AlertDialogCancel>
						<AlertDialogAction
							disabled={isDeleting}
							onClick={(event) => {
								event.preventDefault();
								void confirmDelete();
							}}
						>
							{isDeleting ? (
								<>
									<Spinner data-icon="inline-start" />
									{m.common_saving()}
								</>
							) : (
								m.common_delete()
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function deleteTargetLabel(deleteTarget: DeleteTarget | null) {
	if (!deleteTarget) return "";
	return deleteTarget.type === "model" ? deleteTarget.item.name : deleteTarget.item.sku;
}

function ProductModelActions({
	canDelete,
	canUpdate,
	onEdit,
	onDelete,
}: {
	canDelete: boolean;
	canUpdate: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	if (!canUpdate && !canDelete) {
		return null;
	}
	return (
		<DropdownMenu>
			<Button variant="ghost" size="icon" asChild>
				<DropdownMenuTrigger aria-label={m.common_more_actions()}>
					<MoreHorizontal />
				</DropdownMenuTrigger>
			</Button>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					{canUpdate ? (
						<DropdownMenuItem onSelect={onEdit}>{m.common_edit()}</DropdownMenuItem>
					) : null}
					{canDelete ? (
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={onDelete}
						>
							{m.common_delete()}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProductVariantActions({
	canDelete,
	canUpdate,
	onEdit,
	onDelete,
}: {
	canDelete: boolean;
	canUpdate: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	if (!canUpdate && !canDelete) {
		return null;
	}
	return (
		<DropdownMenu>
			<Button variant="ghost" size="icon" asChild>
				<DropdownMenuTrigger aria-label={m.common_more_actions()}>
					<MoreHorizontal />
				</DropdownMenuTrigger>
			</Button>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					{canUpdate ? (
						<DropdownMenuItem onSelect={onEdit}>{m.common_edit()}</DropdownMenuItem>
					) : null}
					{canDelete ? (
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={onDelete}
						>
							{m.common_delete()}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
