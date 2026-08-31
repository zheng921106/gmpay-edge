import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMerchantOrders } from "#/features/orders/server/admin";
import { applyMigrations } from "../migrations";

const merchantA = "merchant-order-list-a";
const merchantB = "merchant-order-list-b";
const environmentA = "merchant-order-list-a-production";
const environmentB = "merchant-order-list-b-production";

describe("merchant order administration", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-merchant-order-list" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		const now = Date.now();
		await db.batch([
			db
				.prepare(
					"INSERT INTO merchants (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
				)
				.bind(merchantA, merchantA, "Merchant A", now, now),
			db
				.prepare(
					"INSERT INTO merchants (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
				)
				.bind(merchantB, merchantB, "Merchant B", now, now),
			db
				.prepare(
					"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES (?, ?, 'production', 'active', ?, ?)",
				)
				.bind(environmentA, merchantA, now, now),
			db
				.prepare(
					"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES (?, ?, 'production', 'active', ?, ?)",
				)
				.bind(environmentB, merchantB, now, now),
			...[
				["merchant-a-order", merchantA, environmentA],
				["merchant-b-order", merchantB, environmentB],
			].map(([id, merchantId, environmentId]) =>
				db
					.prepare(
						"INSERT INTO orders (id, external_order_id, merchant_id, environment_id, status, amount_minor, currency, currency_decimals, received_amount_units, expires_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', '1250', 'USD', 2, '0', ?, 0, ?, ?)",
					)
					.bind(id, id, merchantId, environmentId, now + 60_000, now, now),
			),
		]);
	});

	afterAll(async () => miniflare.dispose());

	it("lists only the selected merchant environment", async () => {
		await expect(
			listMerchantOrders(
				db,
				{ pageIndex: 0, pageSize: 10, search: "" },
				{ merchantId: merchantA, environmentId: environmentA },
			),
		).resolves.toMatchObject({
			total: 1,
			items: [{ id: "merchant-a-order", externalOrderId: "merchant-a-order" }],
		});
	});
});
