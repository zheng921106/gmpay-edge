import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Input, Password } from "#/components/pro/base/fields/input";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { authClient } from "#/features/auth/auth-client";
import { useAuthAnimation } from "#/features/auth/components/auth-animation-context";
import { registerMerchantFn } from "#/features/auth/server/registration";
import { m } from "#/paraglide/messages";
import { selectMerchantContextFn } from "#/server/merchant-context";

export function SignUp() {
	const navigate = useNavigate();
	const animation = useAuthAnimation();
	const registration = useMutation({
		mutationFn: registerMerchantFn,
		onSuccess: async (merchant, variables) => {
			const signedIn = await authClient.signIn.email({
				email: variables.data.email,
				password: variables.data.password,
				callbackURL: "/admin",
			});
			if (signedIn.error) {
				toast.error(m.auth_sign_up_failed());
				await navigate({
					to: "/sign-in",
					search: { redirect: undefined },
					replace: true,
				});
				return;
			}
			await selectMerchantContextFn({
				data: {
					merchantId: merchant.merchantId,
					environmentId: merchant.environmentIds.production,
					environment: "production",
				},
			});
			toast.success(m.auth_sign_up_success());
			await navigate({ to: "/admin", replace: true });
		},
		onError: () => toast.error(m.auth_sign_up_failed()),
	});
	const schema = z
		.object({
			name: z.string().min(1, m.auth_sign_up_title()),
			slug: z
				.string()
				.regex(
					/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
					m.auth_sign_up_merchant_slug_hint(),
				),
			email: z.email({
				error: (issue) =>
					issue.input === "" ? m.auth_email_required() : m.auth_email_invalid(),
			}),
			password: z.string().min(12, m.auth_password_min()),
			confirmPassword: z.string(),
		})
		.refine((value) => value.password === value.confirmPassword, {
			path: ["confirmPassword"],
			message: m.auth_passwords_do_not_match(),
		});
	const form = useForm({
		defaultValues: {
			name: "",
			slug: "",
			email: "",
			password: "",
			confirmPassword: "",
		},
		validators: { onSubmit: schema },
		onSubmit: ({ value }) =>
			registration.mutate({
				data: {
					name: value.name,
					slug: value.slug,
					email: value.email,
					password: value.password,
				},
			}),
	});

	return (
		<div className="w-full space-y-6">
			<div className="space-y-2">
				<h1 className="font-semibold text-3xl tracking-tight">
					{m.auth_sign_up_title()}
				</h1>
				<p className="text-muted-foreground leading-6">
					{m.auth_sign_up_description()}
				</p>
			</div>
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				<form.Field name="name">
					{(field) => (
						<SignUpField
							field={field}
							id="sign-up-name"
							label={m.auth_sign_up_merchant_name()}
							onFocus={() => animation.setIsTyping(true)}
							onBlur={() => animation.setIsTyping(false)}
						/>
					)}
				</form.Field>
				<form.Field name="slug">
					{(field) => (
						<SignUpField
							field={field}
							id="sign-up-slug"
							label={m.auth_sign_up_merchant_slug()}
							hint={m.auth_sign_up_merchant_slug_hint()}
							onFocus={() => animation.setIsTyping(true)}
							onBlur={() => animation.setIsTyping(false)}
						/>
					)}
				</form.Field>
				<form.Field name="email">
					{(field) => (
						<SignUpField
							field={field}
							id="sign-up-email"
							label={m.common_email()}
							type="email"
							onFocus={() => animation.setIsTyping(true)}
							onBlur={() => animation.setIsTyping(false)}
						/>
					)}
				</form.Field>
				<form.Field name="password">
					{(field) => (
						<SignUpField
							field={field}
							id="sign-up-password"
							label={m.common_password()}
							password
							onFocus={() => animation.setIsTyping(true)}
							onBlur={() => animation.setIsTyping(false)}
						/>
					)}
				</form.Field>
				<form.Field name="confirmPassword">
					{(field) => (
						<SignUpField
							field={field}
							id="sign-up-confirm-password"
							label={m.auth_confirm_password()}
							password
							onFocus={() => animation.setIsTyping(true)}
							onBlur={() => animation.setIsTyping(false)}
						/>
					)}
				</form.Field>
				<Button className="mt-2" disabled={registration.isPending}>
					{registration.isPending ? (
						<Loader2 className="animate-spin" />
					) : (
						<UserPlus />
					)}
					{m.auth_sign_up_submit()}
				</Button>
			</form>
			<p className="text-center text-muted-foreground text-sm">
				{m.auth_sign_up_existing_account()}{" "}
				<Link
					className="font-medium text-foreground hover:underline"
					to="/sign-in"
					search={{ redirect: undefined }}
				>
					{m.auth_sign_up_sign_in()}
				</Link>
			</p>
		</div>
	);
}

function SignUpField({
	field,
	id,
	label,
	hint,
	type,
	password = false,
	onFocus,
	onBlur,
}: {
	field: StringField;
	id: string;
	label: string;
	hint?: string;
	type?: "email";
	password?: boolean;
	onFocus: () => void;
	onBlur: () => void;
}) {
	const error = field.state.meta.errors[0]?.message;
	return (
		<div className="grid gap-2">
			<Label htmlFor={id}>{label}</Label>
			{password ? (
				<Password
					aria-describedby={error ? `${id}-error` : undefined}
					aria-invalid={Boolean(error)}
					id={id}
					name={field.name}
					value={field.state.value}
					onBlur={() => {
						onBlur();
						field.handleBlur();
					}}
					onChange={(event) => field.handleChange(event.currentTarget.value)}
					onFocus={onFocus}
				/>
			) : (
				<Input
					aria-describedby={error ? `${id}-error` : undefined}
					aria-invalid={Boolean(error)}
					id={id}
					name={field.name}
					type={type}
					value={field.state.value}
					onBlur={() => {
						onBlur();
						field.handleBlur();
					}}
					onChange={(event) => field.handleChange(event.currentTarget.value)}
					onFocus={onFocus}
				/>
			)}
			{hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
			{error ? (
				<p className="text-destructive text-sm" id={`${id}-error`}>
					{error}
				</p>
			) : null}
		</div>
	);
}

type StringField = {
	name: string;
	state: {
		value: string;
		meta: { errors: readonly ({ message: string } | undefined)[] };
	};
	handleBlur: () => void;
	handleChange: (value: string) => void;
};
