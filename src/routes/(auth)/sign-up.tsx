import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignUp } from "#/features/auth/pages/sign-up";
import { getInstallStatus } from "#/features/installation/server/functions";
import { createDefaultSeoHead, siteNameFromMatches } from "#/lib/seo";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/(auth)/sign-up")({
	head: ({ matches }) =>
		createDefaultSeoHead({
			title: `${m.auth_sign_up_title()} | ${siteNameFromMatches(matches)}`,
			description: m.auth_sign_up_description(),
			path: "/sign-up",
			siteName: siteNameFromMatches(matches),
		}),
	loader: async () => {
		if (!(await getInstallStatus()).installed)
			throw redirect({ to: "/install" });
	},
	component: SignUp,
});
