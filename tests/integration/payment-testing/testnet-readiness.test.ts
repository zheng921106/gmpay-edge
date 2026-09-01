import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkReceivingMethodReadiness } from "#/features/payment-settings/server/check-method-readiness";
import { applyMigrations } from "../migrations";

describe("payment test rail readiness", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-payment-test-readiness" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		const now = Date.now();
		await db.batch([
			db
				.prepare(
					"INSERT INTO merchants (id, slug, name, status, created_at, updated_at) VALUES ('merchant', 'merchant', 'Merchant', 'active', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES ('sandbox', 'merchant', 'sandbox', 'active', ?, ?)",
				)
				.bind(now, now),
			db.prepare(
				"INSERT OR IGNORE INTO payment_rails (code, name, kind, network_class, adapter, created_at, updated_at) VALUES ('simulator', 'Simulator', 'chain', 'simulated', 'simulator', 1, 1)",
			),
			db.prepare(
				"INSERT OR IGNORE INTO payment_assets (id, rail_code, code, symbol, kind, decimals, default_confirmations, created_at, updated_at) VALUES ('simulator-usdt', 'simulator', 'USDT', 'USDT', 'native', 6, 1, 1, 1)",
			),
			db.prepare(
				"INSERT INTO receiving_methods (id, merchant_id, environment_id, name, rail_code, target_type, target_value, normalized_target_value, enabled, created_at, updated_at) VALUES ('simulator-method', 'merchant', 'sandbox', 'Simulator', 'simulator', 'address', 'sim_defaultmerchant', 'sim_defaultmerchant', 1, 1, 1)",
			),
			db.prepare(
				"INSERT OR IGNORE INTO receiving_method_assets (id, receiving_method_id, payment_asset_id, created_at, updated_at) VALUES ('simulator-link', 'simulator-method', 'simulator-usdt', 1, 1)",
			),
		]);
	});

	afterAll(async () => miniflare.dispose());

	it("accepts a simulated rail in sandbox without an external connection", async () => {
		await expect(
			checkReceivingMethodReadiness(db, "simulator-method", {
				merchantId: "merchant",
				environmentId: "sandbox",
				environmentCode: "sandbox",
				paymentMode: "simulator",
			}),
		).resolves.toMatchObject({ ready: true, status: "ready", reasons: [] });
	});

	it("rejects a rail class that does not match the requested mode", async () => {
		await expect(
			checkReceivingMethodReadiness(db, "simulator-method", {
				merchantId: "merchant",
				environmentId: "sandbox",
				environmentCode: "sandbox",
				paymentMode: "testnet",
			}),
		).resolves.toMatchObject({
			ready: false,
			status: "unsupported",
			reasons: [{ code: "ENVIRONMENT_MISMATCH" }],
		});
	});
});
