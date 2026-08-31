import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "#/db/schema";
import { installSystem } from "#/features/installation/server/install";
import { createPlatformMerchant } from "#/features/merchants/server/platform";
import { applyMigrations } from "../migrations";

describe("platform merchant provisioning", () => {
	let miniflare: Miniflare;
	let db: D1Database;
	let ownerId: string;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-platform-merchant" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		await installSystem(drizzle(db, { schema }), {
			name: "Platform Root",
			email: "root@platform.example",
			password: "a-secure-root-password-123",
		});
		ownerId = "00000000-0000-4000-8000-000000000001";
		await db
			.prepare(
				"INSERT INTO users (id, name, email, email_verified, enabled, created_at, updated_at) VALUES (?, 'Existing Owner', 'owner@example.com', 1, 1, 1, 1)",
			)
			.bind(ownerId)
			.run();
	});

	afterAll(async () => miniflare.dispose());

	it("creates an active merchant, both environments, and an owner membership", async () => {
		const merchant = await createPlatformMerchant(db, {
			name: "Platform Merchant",
			slug: "platform-merchant",
			ownerEmail: "owner@example.com",
			actorUserId: ownerId,
			now: 1_800_000_000_000,
		});
		expect(merchant).toMatchObject({
			name: "Platform Merchant",
			slug: "platform-merchant",
		});
		await expect(
			db
				.prepare(
					`SELECT m.status,
					 (SELECT COUNT(*) FROM merchant_environments e WHERE e.merchant_id = m.id AND e.status = 'active') AS environments,
					 (SELECT r.name FROM merchant_memberships mm
					  JOIN user_roles ur ON ur.user_id = mm.user_id
					  JOIN roles r ON r.id = ur.role_id
					  WHERE mm.merchant_id = m.id AND mm.user_id = ? LIMIT 1) AS owner_role
					 FROM merchants m WHERE m.id = ?`,
				)
				.bind(ownerId, merchant.id)
				.first<{ status: string; environments: number; owner_role: string }>(),
		).resolves.toEqual({
			status: "active",
			environments: 2,
			owner_role: "owner",
		});
		await expect(
			db
				.prepare("SELECT name FROM roles WHERE merchant_id = ? ORDER BY name")
				.bind(merchant.id)
				.all<{ name: string }>(),
		).resolves.toMatchObject({
			results: [
				{ name: "admin" },
				{ name: "operator" },
				{ name: "owner" },
				{ name: "viewer" },
			],
		});
		await expect(
			db
				.prepare(
					`SELECT COUNT(*) AS count,
					 SUM(CASE WHEN api_key IS NULL AND config_encrypted IS NULL THEN 1 ELSE 0 END) AS public_count
					 FROM payment_ingresses WHERE merchant_id = ?`,
				)
				.bind(merchant.id)
				.first<{ count: number; public_count: number }>(),
		).resolves.toEqual({ count: 30, public_count: 30 });
	});
});
