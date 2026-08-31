import { DomainError } from "#/lib/domain-error";

export const assignableMerchantRoleNames = [
	"admin",
	"operator",
	"viewer",
] as const;

export type AssignableMerchantRoleName =
	(typeof assignableMerchantRoleNames)[number];

export async function listMerchantMembers(db: D1Database, merchantId: string) {
	const rows = await db
		.prepare(
			`SELECT u.id AS userId, u.name, u.email, u.image, mm.status, r.name AS roleName
			 FROM merchant_memberships mm
			 JOIN users u ON u.id = mm.user_id
			 JOIN user_roles ur ON ur.user_id = mm.user_id
			 JOIN roles r ON r.id = ur.role_id AND r.merchant_id = mm.merchant_id
			 WHERE mm.merchant_id = ?
			 ORDER BY CASE r.name WHEN 'owner' THEN 0 ELSE 1 END,
			          u.name COLLATE NOCASE, u.id`,
		)
		.bind(merchantId)
		.all<{
			userId: string;
			name: string;
			email: string;
			image: string | null;
			status: "active" | "invited" | "suspended";
			roleName: string;
		}>();
	return rows.results;
}

export async function upsertMerchantMember(
	db: D1Database,
	input: {
		merchantId: string;
		email: string;
		roleName: AssignableMerchantRoleName;
		actorUserId: string;
		requestId?: string | null;
		ipAddress?: string | null;
		now?: number;
	},
) {
	const email = input.email.trim().toLowerCase();
	const [member, role] = await Promise.all([
		db
			.prepare("SELECT id, enabled FROM users WHERE email = ? LIMIT 1")
			.bind(email)
			.first<{ id: string; enabled: number }>(),
		db
			.prepare(
				"SELECT id FROM roles WHERE merchant_id = ? AND name = ? AND enabled = 1 LIMIT 1",
			)
			.bind(input.merchantId, input.roleName)
			.first<{ id: string }>(),
	]);
	if (!member)
		throw new DomainError("merchant_member_not_found", 404, "User not found");
	if (member.enabled !== 1)
		throw new DomainError("merchant_member_disabled", 409, "User is disabled");
	if (!role)
		throw new DomainError(
			"merchant_role_not_found",
			404,
			"Merchant role not found",
		);

	const now = input.now ?? Date.now();
	await db.batch([
		db
			.prepare(
				`INSERT INTO merchant_memberships
				 (id, merchant_id, user_id, status, accepted_at, created_at, updated_at)
				 VALUES (?, ?, ?, 'active', ?, ?, ?)
				 ON CONFLICT(merchant_id, user_id) DO UPDATE SET
				 status = 'active', accepted_at = excluded.accepted_at,
				 updated_at = excluded.updated_at`,
			)
			.bind(crypto.randomUUID(), input.merchantId, member.id, now, now, now),
		db
			.prepare(
				`DELETE FROM user_roles
				 WHERE user_id = ? AND role_id IN (
					SELECT id FROM roles WHERE merchant_id = ?
				 )`,
			)
			.bind(member.id, input.merchantId),
		db
			.prepare(
				"INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)",
			)
			.bind(crypto.randomUUID(), member.id, role.id, now),
		db
			.prepare(
				`INSERT INTO audit_logs
				 (id, actor_user_id, action, target_type, target_id, request_id,
				  ip_address, after, created_at)
				 VALUES (?, ?, 'merchant.member_upserted', 'merchant_member', ?, ?, ?, ?, ?)`,
			)
			.bind(
				crypto.randomUUID(),
				input.actorUserId,
				`${input.merchantId}:${member.id}`,
				input.requestId ?? null,
				input.ipAddress ?? null,
				JSON.stringify({ roleName: input.roleName, status: "active" }),
				now,
			),
	]);
	return { userId: member.id, roleName: input.roleName, status: "active" };
}
