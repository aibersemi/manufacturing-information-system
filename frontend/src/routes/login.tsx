/**
 * Halaman login — Manufacturing Information System.
 *
 * Desain: light mode, gradient background animasi, glassmorphism card.
 * Form: pilihan konveksi (select), username, password.
 * Validasi: TanStack Form + Zod.
 * i18n: Paraglide JS m.* messages.
 *
 * Keamanan:
 * - CSRF token otomatis via requestClient
 * - Pesan error generik (TEN-003)
 * - Tidak menyimpan kredensial di localStorage/sessionStorage
 * - Rate limit handling (429)
 */

import { useForm } from "@tanstack/react-form";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { LogIn } from "lucide-react";
import { z } from "zod";
import { useBackendApiAuthApiLogin, useBackendApiAuthGetTenants } from "@/api/generated/auth/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import * as m from "@/paraglide/messages";
import { rootRoute } from "./root";

// Validasi form login
const loginSchema = z.object({
	tenant_slug: z.string().min(1, m.login_tenant_required()),
	username: z.string().min(1, m.login_username_required()),
	password: z.string().min(1, m.login_password_required()),
});

function getErrorMessage(error: unknown): string {
	const status =
		error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;

	if (status === 429) return m.login_error_rate_limit();
	if (status === 0 || status === 408) return m.login_error_network();
	return m.login_error_generic();
}

function normalizeFieldErrors(errors: unknown[]): Array<{ message?: string }> {
	return errors.flatMap((error) => {
		if (typeof error === "string") return [{ message: error }];
		if (error && typeof error === "object" && "message" in error) {
			return [{ message: String(error.message) }];
		}
		return [];
	});
}

export default function LoginPage() {
	const navigate = useNavigate();
	const tenantsQuery = useBackendApiAuthGetTenants();
	const loginMutation = useBackendApiAuthApiLogin();

	const form = useForm({
		defaultValues: {
			tenant_slug: "",
			username: "",
			password: "",
		},
		validators: {
			onSubmit: loginSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				await loginMutation.mutateAsync({ data: value });
				await navigate({ to: "/dashboard" });
			} catch {
				// State error mutation dirender sebagai Alert di dalam form.
			}
		},
	});

	return (
		<div className="login-gradient flex min-h-dvh items-center justify-center p-4">
			<Card variant="glass" className="relative w-full max-w-md overflow-hidden rounded-2xl">
				<CardHeader className="items-center px-8 pb-6 pt-8 text-center sm:px-10 sm:pt-10">
					<img src="/favicon.png" alt="" className="mb-2 size-14 rounded-xl" aria-hidden="true" />
					<CardTitle asChild>
						<h1>{m.login_title()}</h1>
					</CardTitle>
					<CardDescription>{m.login_description()}</CardDescription>
				</CardHeader>

				<CardContent className="px-8 pb-8 sm:px-10 sm:pb-10">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
						id="login-form"
					>
						<FieldGroup className="gap-5">
							{loginMutation.isError && loginMutation.error ? (
								<Alert variant="destructive" id="login-error-alert">
									<AlertDescription>{getErrorMessage(loginMutation.error)}</AlertDescription>
								</Alert>
							) : tenantsQuery.isError ? (
								<Alert variant="destructive" id="tenant-error-alert">
									<AlertDescription>{m.login_error_network()}</AlertDescription>
								</Alert>
							) : null}

							<form.Field name="tenant_slug">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									const isTenantSelectDisabled = tenantsQuery.isLoading || tenantsQuery.isError;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel id="tenant-select-label" htmlFor="tenant-select-trigger">
												{m.login_tenant_label()}
											</FieldLabel>
											<Select
												value={field.state.value}
												onValueChange={field.handleChange}
												disabled={isTenantSelectDisabled}
												onOpenChange={(open) => {
													if (!open) field.handleBlur();
												}}
											>
												<SelectTrigger
													id="tenant-select-trigger"
													aria-labelledby="tenant-select-label tenant-select-trigger"
													aria-invalid={invalid}
													className="h-11"
												>
													<SelectValue placeholder={m.login_tenant_placeholder()} />
												</SelectTrigger>
												<SelectContent>
													<SelectGroup>
														{tenantsQuery.data?.data.map((tenant) => (
															<SelectItem key={tenant.slug} value={tenant.slug}>
																{tenant.name}
															</SelectItem>
														))}
													</SelectGroup>
												</SelectContent>
											</Select>
											<FieldError errors={normalizeFieldErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>

							<form.Field name="username">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="username-input">{m.login_username_label()}</FieldLabel>
											<Input
												id="username-input"
												name={field.name}
												type="text"
												autoComplete="username"
												placeholder={m.login_username_placeholder()}
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
												className="h-11"
												required
											/>
											<FieldError errors={normalizeFieldErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>

							<form.Field name="password">
								{(field) => {
									const invalid = field.state.meta.errors.length > 0;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor="password-input">{m.login_password_label()}</FieldLabel>
											<Input
												id="password-input"
												name={field.name}
												type="password"
												autoComplete="current-password"
												placeholder={m.login_password_placeholder()}
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={invalid}
												className="h-11"
												required
											/>
											<FieldError errors={normalizeFieldErrors(field.state.meta.errors)} />
										</Field>
									);
								}}
							</form.Field>

							<form.Subscribe selector={(state) => state.isSubmitting}>
								{(isSubmitting) => (
									<Button
										type="submit"
										size="lg"
										className="w-full"
										disabled={
											isSubmitting ||
											loginMutation.isPending ||
											tenantsQuery.isLoading ||
											tenantsQuery.isError
										}
										id="login-submit-button"
									>
										{loginMutation.isPending ? (
											<>
												<Spinner data-icon="inline-start" aria-hidden="true" />
												{m.login_loading()}
											</>
										) : (
											<>
												<LogIn data-icon="inline-start" />
												{m.login_submit()}
											</>
										)}
									</Button>
								)}
							</form.Subscribe>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}

export const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
});
