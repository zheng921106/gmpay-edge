import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAdminBootstrapFn } from "#/features/auth/server/session";
import {
	canAccessAdminPath,
	canAccessMerchantPath,
	merchantSidebarData,
	systemSidebarData,
} from "#/layouts/components/data/sidebar-data";
import { DashboardLayout } from "#/layouts/dashboard";

export const Route = createFileRoute("/admin")({
	gcTime: 0,
	loader: async ({ location }) => {
		let bootstrap: Awaited<ReturnType<typeof getAdminBootstrapFn>>;
		try {
			bootstrap = await getAdminBootstrapFn();
		} catch {
			throw redirect({ to: "/403" });
		}
		if (!bootstrap.installed) {
			throw redirect({
				to: "/install",
			});
		}

		const systemAccess = bootstrap.access;
		if (systemAccess) {
			if (systemAccess.enabled === false) throw redirect({ to: "/403" });
			if (
				location.pathname !== "/admin" &&
				location.pathname !== "/admin/" &&
				!canAccessAdminPath(location.pathname, systemAccess.permissions)
			) {
				throw redirect({ to: "/403" });
			}
			return {
				systemAccess,
				merchantContext: bootstrap.merchantContext,
				user: systemAccess,
			};
		}

		const merchantAccess = bootstrap.merchant;
		if (!merchantAccess) {
			throw redirect({
				to: "/sign-in",
				search: {
					redirect: location.href,
				},
			});
		}

		if (
			location.pathname !== "/admin" &&
			location.pathname !== "/admin/" &&
			!canAccessMerchantPath(location.pathname, merchantAccess.permissions)
		) {
			throw redirect({ to: "/403" });
		}
		return {
			systemAccess: null,
			merchantAccess,
			merchantContext: merchantAccess.context,
			user: merchantAccess.user,
		};
	},
	component: AdminLayoutRoute,
});

function AdminLayoutRoute() {
	const { systemAccess, merchantAccess, merchantContext, user } =
		Route.useLoaderData();
	return (
		<DashboardLayout
			navigation={
				systemAccess
					? systemSidebarData(systemAccess.permissions)
					: merchantSidebarData(merchantAccess?.permissions ?? [])
			}
			permissions={systemAccess?.permissions ?? []}
			merchantPermissions={merchantAccess?.permissions ?? []}
			merchantContext={merchantContext ?? undefined}
			user={user}
		/>
	);
}
