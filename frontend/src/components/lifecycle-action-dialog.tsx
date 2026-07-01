import { useForm } from "@tanstack/react-form";
import { useEffect } from "react";
import { z } from "zod";

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
import { Textarea } from "@/components/ui/textarea";
import { normalizeFormErrors } from "@/lib/tanstack-form";
import * as m from "@/paraglide/messages";

type LifecycleAction = "deactivate" | "delete";

type LifecyclePayload = {
	reason: string;
	confirmation: string;
	actorPassword: string;
};

export function LifecycleActionDialog({
	open,
	action,
	targetLabel,
	confirmationValue,
	blockers = [],
	pending,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	action: LifecycleAction;
	targetLabel: string;
	confirmationValue: string;
	blockers?: string[];
	pending: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (payload: LifecyclePayload) => Promise<void>;
}) {
	const isDelete = action === "delete";
	const form = useForm({
		defaultValues: { reason: "", confirmation: "", actorPassword: "" },
		validators: {
			onSubmit: z
				.object({
					reason: z.string().trim().min(3).max(500),
					confirmation: z.string(),
					actorPassword: z.string(),
				})
				.superRefine((value, context) => {
					if (!isDelete) return;
					if (value.confirmation !== confirmationValue)
						context.addIssue({
							code: "custom",
							path: ["confirmation"],
							message: m.settings_confirmation_mismatch(),
						});
					if (!value.actorPassword)
						context.addIssue({
							code: "custom",
							path: ["actorPassword"],
							message: m.password_required(),
						});
				}),
		},
		onSubmit: async ({ value }) => onConfirm(value),
	});
	useEffect(() => {
		if (open) form.reset();
	}, [open, form]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{isDelete ? m.settings_delete_title() : m.settings_deactivate_title()}
					</DialogTitle>
					<DialogDescription>
						{isDelete
							? m.settings_delete_description({ target: targetLabel })
							: m.settings_deactivate_description({ target: targetLabel })}
					</DialogDescription>
				</DialogHeader>
				{blockers.length ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
						<p className="font-medium">{m.settings_delete_blocked()}</p>
						<ul className="mt-1 list-disc pl-5">
							{blockers.map((blocker) => (
								<li key={blocker}>{blocker}</li>
							))}
						</ul>
					</div>
				) : null}
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<FieldGroup>
						<form.Field name="reason">
							{(field) => (
								<Field>
									<FieldLabel htmlFor="lifecycle-reason">{m.common_reason()}</FieldLabel>
									<Textarea
										id="lifecycle-reason"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
									<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
								</Field>
							)}
						</form.Field>
						{isDelete ? (
							<>
								<form.Field name="confirmation">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="lifecycle-confirmation">
												{m.settings_type_to_confirm({ value: confirmationValue })}
											</FieldLabel>
											<Input
												id="lifecycle-confirmation"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									)}
								</form.Field>
								<form.Field name="actorPassword">
									{(field) => (
										<Field>
											<FieldLabel htmlFor="lifecycle-password">
												{m.settings_actor_password()}
											</FieldLabel>
											<Input
												id="lifecycle-password"
												type="password"
												autoComplete="current-password"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
											<FieldError errors={normalizeFormErrors(field.state.meta.errors)} />
										</Field>
									)}
								</form.Field>
							</>
						) : null}
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								{m.common_cancel()}
							</Button>
							<Button
								type="submit"
								variant={isDelete ? "destructive" : "default"}
								disabled={pending || blockers.length > 0}
							>
								{pending ? <Spinner /> : null}
								{isDelete ? m.common_delete() : m.common_deactivate()}
							</Button>
						</DialogFooter>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}
