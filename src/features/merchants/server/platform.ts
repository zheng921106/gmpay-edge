import { RBAC_REGISTERED_ACTION_MASK } from "#/features/access/rbac-bitmask";
import {
	merchantPaymentIngressInsertStatement,
	merchantPaymentIngressValues,
} from "#/features/merchants/server/payment-ingresses";
import {
	buildSandboxTestBootstrap,
	sandboxTestBootstrapD1Statements,
} from "#/features/payment-testing/server/bootstrap";
import { DomainError } from "#/lib/domain-error";
import { loadRuntimeConfig } from "#/server/runtime-config";

const roleMasks = {
	owner: RBAC_REGISTERED_ACTION_MASK,
	admin: 7,
	operator: 3,
	viewer: 1,
} as const;

export async function createPlatformMerchant(
	db: D1Database,
	input: {
		name: string;
		slug: string;
		ownerEmail: string;
		actorUserId: string;
		now?: number;
	},
) {
	const name = input.name.trim();
	const slug = input.slug.trim().toLowerCase();
	const ownerEmail = input.ownerEmail.trim().toLowerCase();
	if (!name)
		throw new DomainError(
			"merchant_name_required",
			400,
			"Merchant name is required",
		);
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
		throw new DomainError(
			"merchant_slug_invalid",
			400,
			"Merchant slug is invalid",
		);
	const [owner, existing] = await Promise.all([
		db
			.prepare("SELECT id, enabled FROM users WHERE email = ? LIMIT 1")
			.bind(ownerEmail)
			.first<{ id: string; enabled: number }>(),
		db
			.prepare("SELECT id FROM merchants WHERE slug = ? LIMIT 1")
			.bind(slug)
			.first<{ id: string }>(),
	]);
	if (!owner)
		throw new DomainError("merchant_owner_not_found", 404, "Owner not found");
	if (owner.enabled !== 1)
		throw new DomainError("merchant_owner_disabled", 409, "Owner is disabled");
	if (existing)
		throw new DomainError(
			"merchant_slug_in_use",
			409,
			"Merchant slug is already in use",
		);

	const now = input.now ?? Date.now();
	const merchantId = crypto.randomUUID();
	const environments = [
		{ id: crypto.randomUUID(), code: "sandbox" },
		{ id: crypto.randomUUID(), code: "production" },
	] as const;
	const roleIds = new Map(
		Object.keys(roleMasks).map((roleName) => [roleName, crypto.randomUUID()]),
	);
	const runtime = await loadRuntimeConfig(db);
	const sandboxBootstrap = await buildSandboxTestBootstrap({
		merchantId,
		environmentId: environments[0].id,
		apiKeyPepper: runtime.apiKeyPepper,
		now: new Date(now),
	});
	await db.batch([
		db
			.prepare(
				"INSERT INTO merchants (id, slug, name, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
			)
			.bind(merchantId, slug, name, input.actorUserId, now, now),
		...environments.map((environment) =>
			db
				.prepare(
					"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
				)
				.bind(environment.id, merchantId, environment.code, now, now),
		),
		...merchantPaymentIngressValues({
			merchantId,
			environments,
			now: new Date(now),
		}).map((ingress) => merchantPaymentIngressInsertStatement(db, ingress)),
		...sandboxTestBootstrapD1Statements(db, sandboxBootstrap),
		db
			.prepare(
				"INSERT INTO merchant_memberships (id, merchant_id, user_id, status, accepted_at, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?)",
			)
			.bind(crypto.randomUUID(), merchantId, owner.id, now, now, now),
		...[...roleIds].map(([name, id]) =>
			db
				.prepare(
					"INSERT INTO roles (id, merchant_id, name, built_in, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)",
				)
				.bind(id, merchantId, name, now, now),
		),
		db
			.prepare(
				"INSERT INTO user_roles (id, user_id, role_id, created_at) VALUES (?, ?, ?, ?)",
			)
			.bind(crypto.randomUUID(), owner.id, roleIds.get("owner") as string, now),
		...[...roleIds].map(([name, roleId]) =>
			db
				.prepare(
					"INSERT INTO role_permissions (id, role_id, module, permission_mask, created_at, updated_at) VALUES (?, ?, 'merchant', ?, ?, ?)",
				)
				.bind(
					crypto.randomUUID(),
					roleId,
					roleMasks[name as keyof typeof roleMasks],
					now,
					now,
				),
		),
		db
			.prepare(
				`INSERT INTO audit_logs
				 (id, actor_user_id, action, target_type, target_id, after, created_at)
				 VALUES (?, ?, 'merchant.created', 'merchant', ?, ?, ?)`,
			)
			.bind(
				crypto.randomUUID(),
				input.actorUserId,
				merchantId,
				JSON.stringify({ name, slug, ownerEmail }),
				now,
			),
	]);
	return {
		id: merchantId,
		name,
		slug,
		sandboxCredential: sandboxBootstrap.plaintextCredential,
	};
}

export async function listPlatformMerchants(db: D1Database) {
	const rows = await db
		.prepare(
			`SELECT m.id, m.name, m.slug, m.status, m.created_at,
			 COUNT(DISTINCT mm.user_id) AS memberCount,
			 SUM(CASE WHEN me.code = 'sandbox' AND me.status = 'active' THEN 1 ELSE 0 END) AS sandboxActive,
			 SUM(CASE WHEN me.code = 'production' AND me.status = 'active' THEN 1 ELSE 0 END) AS productionActive
			 FROM merchants m
			 LEFT JOIN merchant_memberships mm ON mm.merchant_id = m.id
			 LEFT JOIN merchant_environments me ON me.merchant_id = m.id
			 GROUP BY m.id ORDER BY m.created_at DESC, m.id DESC`,
		)
		.all<{
			id: string;
			name: string;
			slug: string;
			status: "active" | "suspended";
			created_at: number;
			memberCount: number;
			sandboxActive: number;
			productionActive: number;
		}>();
	return rows.results.map((merchant) => ({
		id: merchant.id,
		name: merchant.name,
		slug: merchant.slug,
		status: merchant.status,
		memberCount: merchant.memberCount,
		environments: {
			sandboxActive: merchant.sandboxActive === 1,
			productionActive: merchant.productionActive === 1,
		},
		createdAt: new Date(merchant.created_at).toISOString(),
	}));
}

export async function setPlatformMerchantStatus(
	db: D1Database,
	input: {
		merchantId: string;
		status: "active" | "suspended";
		actorUserId: string;
		now?: number;
	},
) {
	const now = input.now ?? Date.now();
	const result = await db
		.prepare("UPDATE merchants SET status = ?, updated_at = ? WHERE id = ?")
		.bind(input.status, now, input.merchantId)
		.run();
	if ((result.meta.changes ?? 0) !== 1)
		throw new DomainError("merchant_not_found", 404, "Merchant not found");
	await db
		.prepare(
			"INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, after, created_at) VALUES (?, ?, 'merchant.status_changed', 'merchant', ?, ?, ?)",
		)
		.bind(
			crypto.randomUUID(),
			input.actorUserId,
			input.merchantId,
			JSON.stringify({ status: input.status }),
			now,
		)
		.run();
	return { id: input.merchantId, status: input.status };
}

export async function setPlatformEnvironmentStatus(
	db: D1Database,
	input: {
		merchantId: string;
		environment: "sandbox" | "production";
		status: "active" | "suspended";
		actorUserId: string;
		now?: number;
	},
) {
	const now = input.now ?? Date.now();
	const result = await db
		.prepare(
			"UPDATE merchant_environments SET status = ?, updated_at = ? WHERE merchant_id = ? AND code = ?",
		)
		.bind(input.status, now, input.merchantId, input.environment)
		.run();
	if ((result.meta.changes ?? 0) !== 1)
		throw new DomainError(
			"merchant_environment_not_found",
			404,
			"Merchant environment not found",
		);
	await db
		.prepare(
			"INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, after, created_at) VALUES (?, ?, 'merchant.environment_status_changed', 'merchant_environment', ?, ?, ?)",
		)
		.bind(
			crypto.randomUUID(),
			input.actorUserId,
			`${input.merchantId}:${input.environment}`,
			JSON.stringify({ environment: input.environment, status: input.status }),
			now,
		)
		.run();
	return {
		merchantId: input.merchantId,
		environment: input.environment,
		status: input.status,
	};
}
