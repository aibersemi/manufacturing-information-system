import { useForm } from "@tanstack/react-form";
import { LockKeyhole } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useBackendApiAdministrationResetUserPassword } from "@/api/generated/administration/administration";
import { useBackendApiAuthChangePassword } from "@/api/generated/auth/auth";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/request-client";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

const passwordSchema = z
	.object({
		currentPassword: z.string().min(1),
		newPassword: z.string().min(8, m.password_required()),
		confirmation: z.string().min(8, m.password_required()),
	})
	.refine((value) => value.newPassword === value.confirmation, {
		message: m.password_mismatch(),
		path: ["confirmation"],
	});

type PasswordValues = { currentPassword: string; newPassword: string; confirmation: string };

function usePasswordForm(onSubmit: (value: PasswordValues) => Promise<void>) {
	return useForm({
		defaultValues: { currentPassword: "", newPassword: "", confirmation: "" },
		validators: { onSubmit: passwordSchema },
		onSubmit: async ({ value }) => onSubmit(value),
	});
}

function PasswordFields({
	form,
	actorLabel,
}: {
	form: ReturnType<typeof usePasswordForm>;
	actorLabel?: string;
}) {
	return (
		<FieldGroup>
			<form.Field name="currentPassword">
				{(field) => (
					<Field data-invalid={field.state.meta.errors.length > 0}>
						<FieldLabel htmlFor="password-current">{actorLabel ?? m.password_current()}</FieldLabel>
						<Input
							id="password-current"
							type="password"
							autoComplete="current-password"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							aria-invalid={field.state.meta.errors.length > 0}
						/>
						<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			<form.Field name="newPassword">
				{(field) => (
					<Field data-invalid={field.state.meta.errors.length > 0}>
						<FieldLabel htmlFor="password-new">{m.password_new()}</FieldLabel>
						<Input
							id="password-new"
							type="password"
							autoComplete="new-password"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							aria-invalid={field.state.meta.errors.length > 0}
						/>
						<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
			<form.Field name="confirmation">
				{(field) => (
					<Field data-invalid={field.state.meta.errors.length > 0}>
						<FieldLabel htmlFor="password-confirmation">{m.password_confirmation()}</FieldLabel>
						<Input
							id="password-confirmation"
							type="password"
							autoComplete="new-password"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							aria-invalid={field.state.meta.errors.length > 0}
						/>
						<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
					</Field>
				)}
			</form.Field>
		</FieldGroup>
	);
}

function ChangePasswordDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const mutation = useBackendApiAuthChangePassword();
	const form = usePasswordForm(async (value) => {
		try {
			await mutation.mutateAsync({
				data: {
					current_password: value.currentPassword,
					new_password: value.newPassword,
					new_password_confirmation: value.confirmation,
				},
			});
			toast.success(m.password_changed());
			onOpenChange(false);
			form.reset();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	});
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.password_change_title()}</DialogTitle>
					<DialogDescription>{m.password_change_description()}</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<PasswordFields form={form} />
					<DialogFooter className="mt-6">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{m.common_cancel()}
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<LockKeyhole data-icon="inline-start" />
							)}
							{m.account_change_password()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ResetPasswordDialog({
	userId,
	username,
	open,
	onOpenChange,
}: {
	userId: number | null;
	username: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const mutation = useBackendApiAdministrationResetUserPassword();
	const form = usePasswordForm(async (value) => {
		if (userId === null) return;
		try {
			await mutation.mutateAsync({
				userId,
				data: {
					actor_password: value.currentPassword,
					new_password: value.newPassword,
					new_password_confirmation: value.confirmation,
				},
			});
			toast.success(m.settings_reset_success());
			onOpenChange(false);
			form.reset();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : m.common_mutation_error());
		}
	});
	useEffect(() => {
		if (!open) form.reset();
	}, [open, form]);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{m.settings_password_reset_title()}</DialogTitle>
					<DialogDescription>
						{m.settings_password_reset_description()} {username}
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<PasswordFields form={form} actorLabel={m.settings_actor_password()} />
					<DialogFooter className="mt-6">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{m.common_cancel()}
						</Button>
						<Button type="submit" disabled={mutation.isPending}>
							{mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
							{m.settings_user_reset_password()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export { ChangePasswordDialog, ResetPasswordDialog };
