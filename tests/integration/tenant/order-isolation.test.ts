import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listCheckoutPaymentOptions } from "#/features/checkout/server/payment-options";
import {
	createOrder,
	OrderServiceError,
} from "#/features/orders/server/create";
import { getOrder } from "#/features/orders/server/query";
import { applyMigrations } from "../migrations";

const merchantA = "merchant-a";
const merchantB = "merchant-b";
const productionA = "environment-a-production";
const sandboxA = "environment-a-sandbox";
const productionB = "environment-b-production";
const externalOrderId = "merchant-shared-order";

describe("merchant order isolation", () => {
	let miniflare: Miniflare;
	let db: D1Database;
	let orderAId: string;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-order-isolation-v2" },
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
			...[
				[productionA, merchantA, "production"],
				[sandboxA, merchantA, "sandbox"],
				[productionB, merchantB, "production"],
			].map(([id, merchantId, code]) =>
				db
					.prepare(
						"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
					)
					.bind(id, merchantId, code, now, now),
			),
			db
				.prepare(
					"INSERT INTO payment_rails (code, name, kind, adapter, created_at, updated_at) VALUES ('tron', 'TRON', 'chain', 'tron', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO payment_assets (id, rail_code, code, symbol, kind, contract_address, decimals, created_at, updated_at) VALUES ('asset-isolation-usdt-tron', 'tron', 'USDT', 'USDT', 'token', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 6, ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO payment_ingresses (id, merchant_id, environment_id, rail_code, name, type, endpoint, enabled, health_status, created_at, updated_at) VALUES ('connection-b', ?, ?, 'tron', 'TRON B', 'rpc', 'https://api.trongrid.io', 1, 'healthy', ?, ?)",
				)
				.bind(merchantB, productionB, now, now),
			db
				.prepare(
					"INSERT INTO receiving_methods (id, merchant_id, environment_id, name, rail_code, target_type, target_value, normalized_target_value, enabled, created_at, updated_at) VALUES ('method-isolation-b', ?, ?, 'Merchant B USDT', 'tron', 'address', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 1, ?, ?)",
				)
				.bind(merchantB, productionB, now, now),
		]);
	});

	afterAll(async () => miniflare.dispose());

	it("allows identical external IDs only in separate merchant environments", async () => {
		const input = {
			externalOrderId,
			amount: "12.50",
			currency: "USD",
			notifyUrl: "https://merchant.example/webhook",
		};
		const orderA = await createOrder(db, input, "https://pay.example", {
			merchantId: merchantA,
			environmentId: productionA,
			environment: "production",
		});
		orderAId = orderA.orderId;
		const orderB = await createOrder(db, input, "https://pay.example", {
			merchantId: merchantB,
			environmentId: productionB,
			environment: "production",
		});
		const sandbox = await createOrder(db, input, "https://pay.example", {
			merchantId: merchantA,
			environmentId: sandboxA,
			environment: "sandbox",
		});
		expect(
			new Set([orderA.orderId, orderB.orderId, sandbox.orderId]).size,
		).toBe(3);
		await expect(
			createOrder(db, input, "https://pay.example", {
				merchantId: merchantA,
				environmentId: productionA,
				environment: "production",
			}),
		).rejects.toBeInstanceOf(OrderServiceError);
		await expect(
			getOrder(
				db,
				{
					id: orderB.orderId,
					merchantId: merchantA,
					environmentId: productionA,
				},
				"https://pay.example",
			),
		).resolves.toBeNull();
	});

	it("does not expose another merchant's receiving methods in checkout", async () => {
		await expect(
			listCheckoutPaymentOptions(db, orderAId),
		).resolves.toMatchObject({
			selectable: true,
			options: [],
		});
	});
});
