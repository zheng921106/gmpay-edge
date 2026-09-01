import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCheckoutOrderWithDatabase } from "#/features/checkout/server/checkout-order";
import { applyMigrations } from "../migrations";

describe("checkout merchant identity", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-checkout-merchant-identity" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		const now = Date.now();
		await db.batch([
			db
				.prepare(
					"INSERT INTO merchants (id, slug, name, status, created_at, updated_at) VALUES ('merchant-north', 'merchant-north', 'Merchant North', 'active', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES ('merchant-north-sandbox', 'merchant-north', 'sandbox', 'active', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO orders (id, merchant_id, environment_id, external_order_id, status, amount_minor, currency, currency_decimals, received_amount_units, expires_at, created_at, updated_at) VALUES ('checkout-merchant-order', 'merchant-north', 'merchant-north-sandbox', 'external-1', 'pending', '1250', 'USD', 2, '0', ?, ?, ?)",
				)
				.bind(now + 900_000, now, now),
		]);
	});

	afterAll(async () => miniflare.dispose());

	it("returns the public merchant name and environment for the order", async () => {
		await expect(
			getCheckoutOrderWithDatabase(db, "checkout-merchant-order"),
		).resolves.toMatchObject({
			merchant_name: "Merchant North",
			environment: "sandbox",
		});
	});
});
