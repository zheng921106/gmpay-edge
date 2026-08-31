import { mergeRolePermissions } from "#/features/access/permissions";
import {
	AccessDeniedError,
	type AccessSessionUser,
} from "#/features/access/server/access-cache";
import { getAuth } from "#/features/auth/server/auth";
import { getCloudflareEnv } from "#/server/db.server";
import { loadMerchantContext } from "#/server/merchant-context";

export type MerchantPermission = {
	module: string;
	permissionMask: number;
};

export type MerchantRolePermissionRow = {
	merchantId: string;
	userId: string;
	enabled: boolean;
	status: string;
	permissionMask: number | null;
	module: string | null;
};

export function evaluateMerchantPermission(
	rows: readonly MerchantRolePermissionRow[],
	merchantId: string,
	userId: string,
	requirement: MerchantPermission,
) {
	const permissions = mergeRolePermissions(
		rows
			.filter(
				(row) =>
					row.merchantId === merchantId &&
					row.userId === userId &&
					row.enabled &&
					row.status === "active" &&
					row.module !== null &&
					row.permissionMask !== null,
			)
			.map((row) => ({
				module: row.module as string,
				permissionMask: row.permissionMask as number,
			})),
	);
	const granted = permissions.get(requirement.module) ?? 0;
	return (granted & requirement.permissionMask) === requirement.permissionMask;
}

export async function requireMerchantAccess(
	request: Request,
	requirement: MerchantPermission,
) {
	const access = await loadMerchantSession(request);
	const context = await loadMerchantContext(request, access);
	if (access.root) {
		return {
			...access.user,
			roles: ["root"],
			root: true,
			context,
			merchantPermissions: new Map(),
		};
	}

	const db = getCloudflareEnv(request).DB;
	if (!db) throw new Error("D1 binding DB is unavailable");
	const rows = await db
		.prepare(
			`SELECT r.merchant_id AS merchantId, ur.user_id AS userId,
					 r.enabled AS enabled, mm.status AS status,
					 rp.module AS module, rp.permission_mask AS permissionMask
			 FROM merchant_memberships mm
			 JOIN user_roles ur ON ur.user_id = mm.user_id
			 JOIN roles r ON r.id = ur.role_id AND r.merchant_id = mm.merchant_id
			 LEFT JOIN role_permissions rp ON rp.role_id = r.id
			 WHERE mm.merchant_id = ? AND mm.user_id = ? AND mm.status = 'active'`,
		)
		.bind(context.merchantId, access.user.id)
		.all<MerchantRolePermissionRow>();
	const merchantPermissions = mergeRolePermissions(
		rows.results.map((row) => ({
			module: row.module ?? "",
			permissionMask: row.permissionMask ?? 0,
		})),
	);
	if (
		!evaluateMerchantPermission(
			rows.results,
			context.merchantId,
			access.user.id,
			requirement,
		)
	) {
		throw new AccessDeniedError(403);
	}
	return {
		...access.user,
		roles: [],
		root: false,
		context,
		merchantPermissions,
	};
}

async function loadMerchantSession(request: Request) {
	const session = await (await getAuth(request)).api.getSession({
		headers: request.headers,
	});
	if (!session?.user) throw new AccessDeniedError(401);
	const user = session.user as AccessSessionUser;
	if (user.enabled !== true) throw new AccessDeniedError(403);
	const db = getCloudflareEnv(request).DB;
	if (!db) throw new Error("D1 binding DB is unavailable");
	const root = await db
		.prepare(
			`SELECT r.id FROM user_roles ur
			 JOIN roles r ON r.id = ur.role_id
			 WHERE ur.user_id = ? AND r.merchant_id IS NULL
			   AND r.name = 'root' AND r.enabled = 1 LIMIT 1`,
		)
		.bind(user.id)
		.first<{ id: string }>();
	return { user, root: Boolean(root) };
}
