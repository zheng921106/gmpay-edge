import { mergeRolePermissions } from "#/features/access/permissions";
import { requireAdmin } from "#/features/access/server/require-admin";
import { getCloudflareEnv } from "#/server/db.server";
import { loadMerchantContext } from "#/server/merchant-context";
import { AccessDeniedError } from "./access-cache";

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
	const admin = await requireAdmin(request);
	const context = await loadMerchantContext(request, {
		user: admin,
		root: admin.root,
	});
	if (admin.root) return { ...admin, context, merchantPermissions: new Map() };

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
		.bind(context.merchantId, admin.id)
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
			admin.id,
			requirement,
		)
	) {
		throw new AccessDeniedError(403);
	}
	return { ...admin, context, merchantPermissions };
}
