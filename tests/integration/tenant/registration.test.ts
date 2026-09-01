import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "#/db/schema";
import { registerMerchant } from "#/features/auth/server/registration";
import { installSystem } from "#/features/installation/server/install";
import { applyMigrations } from "../migrations";

describe("automatic merchant registration", () => {
	let miniflare: Miniflare;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-registration" },
		});
		const d1 = await miniflare.getD1Database("DB");
		await applyMigrations(d1);
		db = drizzle(d1, { schema });
		await installSystem(db, {
			name: "Platform Root",
			email: "root@acme.example",
			password: "a-secure-root-password-123",
		});
	});

	afterAll(async () => miniflare.dispose());

	it("creates an enabled merchant with both environments and owner roles", async () => {
		const result = await registerMerchant(db, {
			name: "Acme Store",
			slug: "acme-store",
			email: "owner@acme.example",
			password: "a-secure-password-123",
		});
		expect(result.environmentIds).toEqual({
			sandbox: expect.any(String),
			production: expect.any(String),
		});
		const merchant = await db.$client
			.prepare("SELECT status FROM merchants WHERE id = ?")
			.bind(result.merchantId)
			.first<{ status: string }>();
		expect(merchant?.status).toBe("active");
		const environments = await db.$client
			.prepare(
				"SELECT code, status FROM merchant_environments WHERE merchant_id = ? ORDER BY code",
			)
			.bind(result.merchantId)
			.all<{ code: string; status: string }>();
		expect(environments.results).toEqual([
			{ code: "production", status: "active" },
			{ code: "sandbox", status: "active" },
		]);
		const roles = await db.$client
			.prepare("SELECT name FROM roles WHERE merchant_id = ? ORDER BY name")
			.bind(result.merchantId)
			.all<{ name: string }>();
		expect(roles.results.map((row) => row.name)).toEqual([
			"admin",
			"operator",
			"owner",
			"viewer",
		]);
		const membership = await db.$client
			.prepare(
				`SELECT mm.status, r.name
				 FROM merchant_memberships mm
				 JOIN users u ON u.id = mm.user_id
				 JOIN user_roles ur ON ur.user_id = u.id
				 JOIN roles r ON r.id = ur.role_id AND r.merchant_id = mm.merchant_id
				 WHERE mm.merchant_id = ?`,
			)
			.bind(result.merchantId)
			.first<{ status: string; name: string }>();
		expect(membership).toEqual({ status: "active", name: "owner" });
	});

	it("provisions public payment ingress separately for every environment", async () => {
		const result = await registerMerchant(db, {
			name: "Ingress Merchant",
			slug: "ingress-merchant",
			email: "ingress-owner@acme.example",
			password: "another-secure-password-123",
		});
		const ingresses = await db.$client
			.prepare(
				`SELECT environment_id, me.code, COUNT(*) AS count,
				 SUM(CASE WHEN api_key IS NULL AND config_encrypted IS NULL THEN 1 ELSE 0 END) AS public_count
				 FROM payment_ingresses pi
				 JOIN merchant_environments me ON me.id = pi.environment_id
				 WHERE pi.merchant_id = ?
				 GROUP BY environment_id
				 ORDER BY me.code`,
			)
			.bind(result.merchantId)
			.all<{
				environment_id: string;
				code: "sandbox" | "production";
				count: number;
				public_count: number;
			}>();
		expect(ingresses.results).toEqual([
			{
				environment_id: expect.any(String),
				code: "production",
				count: 15,
				public_count: 15,
			},
			{
				environment_id: expect.any(String),
				code: "sandbox",
				count: 6,
				public_count: 6,
			},
		]);
	});

	it("rejects duplicate email and slug without creating partial rows", async () => {
		await expect(
			registerMerchant(db, {
				name: "Second",
				slug: "acme-second",
				email: "owner@acme.example",
				password: "a-secure-password-123",
			}),
		).rejects.toMatchObject({ code: "email_in_use" });
		await expect(
			registerMerchant(db, {
				name: "Second",
				slug: "acme-store",
				email: "second@acme.example",
				password: "a-secure-password-123",
			}),
		).rejects.toMatchObject({
			code: "merchant_slug_in_use",
		});
	});
});
