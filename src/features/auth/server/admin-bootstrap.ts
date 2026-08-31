import { createServerOnlyFn } from "@tanstack/react-start";
import { AccessDeniedError } from "#/features/access/server/access-cache";
import { requireMerchantAccess } from "#/features/access/server/merchant-access";
import { getAdminPermissions } from "#/features/access/server/require-admin";
import { isInstalled } from "#/features/installation/server/install";
import { getDb } from "#/server/db.server";
import {
	loadMerchantContext,
	merchantContextCookieName,
} from "#/server/merchant-context";

export const loadAdminBootstrap = createServerOnlyFn(
	async (request: Request) => {
		if (!(await isInstalled(getDb(request))))
			return { installed: false } as const;
		try {
			const access = await getAdminPermissions(request);
			return {
				installed: true,
				access,
				merchant: null,
				merchantContext: await loadSystemMerchantContext(request, access),
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

async function loadSystemMerchantContext(
	request: Request,
	access: Awaited<ReturnType<typeof getAdminPermissions>>,
) {
	if (!request.headers.get("cookie")?.includes(`${merchantContextCookieName}=`))
		return null;
	try {
		return await loadMerchantContext(request, {
			user: {
				id: access.id,
				name: access.name,
				email: access.email,
				enabled: access.enabled,
				updatedAt: access.updatedAt,
			},
			root: access.root,
		});
	} catch (error) {
		if (!(error instanceof AccessDeniedError)) throw error;
		return null;
	}
}
