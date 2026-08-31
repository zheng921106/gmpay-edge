import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("multi-merchant legacy backfill migration", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-tenant-migration" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrationRange(db, 0, 6);
		const now = Date.now();
		await db.batch([
			db
				.prepare(
					"INSERT INTO users (id, name, email, enabled, created_at, updated_at) VALUES ('legacy-user', 'Legacy User', 'legacy@example.com', 1, ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO payment_rails (code, name, kind, adapter, created_at, updated_at) VALUES ('tron', 'TRON', 'chain', 'tron', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO api_keys (id, name, pid, secret_encrypted, scopes, created_at, updated_at) VALUES ('legacy-key', 'Legacy', 'legacy-pid', 'encrypted', '[\"orders:create\"]', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO payment_ingresses (id, rail_code, name, type, transport, endpoint, enabled, health_status, created_at, updated_at) VALUES ('legacy-ingress', 'tron', 'Legacy RPC', 'rpc', 'http', 'https://rpc.example', 1, 'unknown', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO receiving_methods (id, name, rail_code, target_type, target_value, normalized_target_value, created_at, updated_at) VALUES ('legacy-receiving', 'Legacy address', 'tron', 'address', 'Tlegacy', 'tlegacy', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO orders (id, external_order_id, api_key_id, api_protocol, amount_minor, currency, currency_decimals, expires_at, created_at, updated_at) VALUES ('legacy-order', 'legacy-order-1', 'legacy-key', 'gmpay', '100', 'USD', 2, ?, ?, ?)",
				)
				.bind(now + 60_000, now, now),
		]);
		await applyMigrationRange(db, 7, 9);
	});

	afterAll(async () => miniflare.dispose());

	it("creates one default merchant with active sandbox and production environments", async () => {
		const merchant = await db
			.prepare("SELECT id, slug, status FROM merchants")
			.first<{ id: string; slug: string; status: string }>();
		expect(merchant).toEqual({
			id: "default-merchant",
			slug: "default",
			status: "active",
		});
		const environments = await db
			.prepare(
				"SELECT id, code, status FROM merchant_environments WHERE merchant_id = 'default-merchant' ORDER BY code",
			)
			.all<{ id: string; code: string; status: string }>();
		expect(environments.results).toEqual([
			{ id: "default-production", code: "production", status: "active" },
			{ id: "default-sandbox", code: "sandbox", status: "active" },
		]);
	});

	it("preserves legacy IDs while backfilling production scope and membership", async () => {
		const membership = await db
			.prepare(
				"SELECT merchant_id, user_id, status FROM merchant_memberships WHERE user_id = 'legacy-user'",
			)
			.first();
		expect(membership).toEqual({
			merchant_id: "default-merchant",
			user_id: "legacy-user",
			status: "active",
		});
		const rows = await db
			.prepare(
				`SELECT
					(SELECT merchant_id FROM api_keys WHERE id = 'legacy-key') AS api_merchant_id,
					(SELECT environment_id FROM api_keys WHERE id = 'legacy-key') AS api_environment_id,
					(SELECT merchant_id FROM orders WHERE id = 'legacy-order') AS order_merchant_id,
					(SELECT environment_id FROM orders WHERE id = 'legacy-order') AS order_environment_id,
					(SELECT merchant_id FROM receiving_methods WHERE id = 'legacy-receiving') AS receiving_merchant_id,
					(SELECT environment_id FROM receiving_methods WHERE id = 'legacy-receiving') AS receiving_environment_id`,
			)
			.first();
		expect(rows).toEqual({
			api_merchant_id: "default-merchant",
			api_environment_id: "default-production",
			order_merchant_id: "default-merchant",
			order_environment_id: "default-production",
			receiving_merchant_id: "default-merchant",
			receiving_environment_id: "default-production",
		});
	});

	it("creates a credential-free sandbox copy of the legacy payment ingress", async () => {
		await expect(
			db
				.prepare(
					`SELECT id, merchant_id, environment_id, api_key, config_encrypted
					 FROM payment_ingresses WHERE id = 'default-sandbox:legacy-ingress'`,
				)
				.first(),
		).resolves.toEqual({
			id: "default-sandbox:legacy-ingress",
			merchant_id: "default-merchant",
			environment_id: "default-sandbox",
			api_key: null,
			config_encrypted: null,
		});
	});

	it("uses scope-leading indexes for merchant order lookups", async () => {
		const plan = await db
			.prepare(
				"EXPLAIN QUERY PLAN SELECT id FROM orders WHERE merchant_id = ? AND environment_id = ? AND api_key_id = ? AND external_order_id = ?",
			)
			.bind(
				"default-merchant",
				"default-production",
				"legacy-key",
				"legacy-order-1",
			)
			.all<{ detail: string }>();
		expect(plan.results.map((row) => row.detail).join(" ")).toContain(
			"orders_merchant_environment_api_key_external_id_uidx",
		);
	});
});

async function applyMigrationRange(
	database: D1Database,
	from: number,
	to: number,
) {
	const directory = new URL("../../../drizzle/", import.meta.url);
	const files = (await readdir(directory))
		.filter((name) => /^\d+_.+\.sql$/.test(name))
		.filter((name) => {
			const number = Number(name.slice(0, 4));
			return number >= from && number <= to;
		})
		.sort();
	for (const file of files) {
		const migration = await readFile(new URL(file, directory), "utf8");
		for (const statement of migration
			.split("--> statement-breakpoint")
			.map((value) => value.trim())
			.filter(Boolean)) {
			await database.prepare(statement).run();
		}
	}
}
