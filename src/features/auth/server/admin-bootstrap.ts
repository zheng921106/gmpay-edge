import { createServerOnlyFn } from "@tanstack/react-start";
import { AccessDeniedError } from "#/features/access/server/access-cache";
import { requireMerchantAccess } from "#/features/access/server/merchant-access";
import { getAdminPermissions } from "#/features/access/server/require-admin";
import { isInstalled } from "#/features/installation/server/install";
import { getDb } from "#/server/db.server";

export const loadAdminBootstrap = createServerOnlyFn(
	async (request: Request) => {
		if (!(await isInstalled(getDb(request))))
			return { installed: false } as const;
		try {
			return {
				installed: true,
				access: await getAdminPermissions(request),
				merchant: null,
			} as const;
		} catch (error) {
			if (error instanceof AccessDeniedError && error.status === 401)
				return { installed: true, access: null, merchant: null } as const;
			if (error instanceof AccessDeniedError && error.status === 403) {
				const merchant = await loadMerchantBootstrap(request);
				return { installed: true, access: null, merchant } as const;
			}
			throw error;
		}
	},
);

async function loadMerchantBootstrap(request: Request) {
	try {
		const access = await requireMerchantAccess(request, {
			module: "merchant",
			permissionMask: 1,
		});
		return {
			user: access,
			context: access.context,
			permissions: [...access.merchantPermissions].map(
				([module, permissionMask]) => ({ module, permissionMask }),
			),
		};
	} catch (error) {
		if (error instanceof AccessDeniedError) return null;
		throw error;
	}
}
