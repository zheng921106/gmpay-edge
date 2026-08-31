import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolvePaymentTransactionOrder } from "#/features/payments/server/attribution";
import { applyMigrations } from "../migrations";

const merchantA = "merchant-attribution-a";
const merchantB = "merchant-attribution-b";
const environmentA = "merchant-attribution-a-production";
const environmentB = "merchant-attribution-b-production";
const target = "TTarget11111111111111111111111111";

describe("merchant payment attribution", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-payment-attribution-isolation" },
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
				[environmentA, merchantA],
				[environmentB, merchantB],
			].map(([id, merchantId]) =>
				db
					.prepare(
						"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES (?, ?, 'production', 'active', ?, ?)",
					)
					.bind(id, merchantId, now, now),
			),
			db
				.prepare(
					"INSERT INTO payment_rails (code, name, kind, adapter, created_at, updated_at) VALUES ('tron', 'TRON', 'chain', 'tron', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO payment_assets (id, rail_code, code, symbol, kind, decimals, created_at, updated_at) VALUES ('asset-attribution-usdt', 'tron', 'USDT', 'USDT', 'token', 6, ?, ?)",
				)
				.bind(now, now),
			...[
				[
					"method-attribution-a",
					merchantA,
					environmentA,
					"order-attribution-a",
				],
				[
					"method-attribution-b",
					merchantB,
					environmentB,
					"order-attribution-b",
				],
			].flatMap(([methodId, merchantId, environmentId, orderId]) => [
				db
					.prepare(
						"INSERT INTO receiving_methods (id, merchant_id, environment_id, name, rail_code, target_type, target_value, normalized_target_value, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 'tron', 'address', ?, ?, 1, ?, ?)",
					)
					.bind(
						methodId,
						merchantId,
						environmentId,
						methodId,
						target,
						target,
						now,
						now,
					),
				db
					.prepare(
						"INSERT INTO orders (id, external_order_id, merchant_id, environment_id, status, amount_minor, currency, currency_decimals, payment_asset_id, received_amount_units, expires_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', '100', 'USD', 2, 'asset-attribution-usdt', '0', ?, 0, ?, ?)",
					)
					.bind(
						orderId,
						orderId,
						merchantId,
						environmentId,
						now + 60_000,
						now,
						now,
					),
				db
					.prepare(
						"INSERT INTO order_payment_snapshots (order_id, receiving_method_id, receiving_method_name, rail_code, rail_kind, asset_id, asset_code, decimals, target_value, adapter, required_confirmations, expected_amount_units, created_at) VALUES (?, ?, ?, 'tron', 'chain', 'asset-attribution-usdt', 'USDT', 6, ?, 'tron', 1, '1000000', ?)",
					)
					.bind(orderId, methodId, methodId, target, now),
				db
					.prepare(
						"INSERT INTO receiving_method_locks (id, receiving_method_id, asset_id, order_id, expected_amount_units, collision_key, expires_at, reusable_at, created_at) VALUES (?, ?, 'asset-attribution-usdt', ?, '1000000', ?, ?, ?, ?)",
					)
					.bind(
						`lock-${orderId}`,
						methodId,
						orderId,
						`collision-${orderId}`,
						now + 60_000,
						now + 60_000,
						now,
					),
			]),
		]);
	});

	afterAll(async () => miniflare.dispose());

	it("does not attribute a shared target transaction across merchant environments", async () => {
		const transaction = {
			network: "tron" as const,
			hash: "shared-target-transaction",
			eventIndex: 0,
			from: "TFrom11111111111111111111111111",
			to: target,
			assetCode: "USDT",
			amountUnits: 1_000_000n,
			blockNumber: 1n,
			blockHash: "block-1",
			confirmations: 1,
			timestamp: new Date(),
			success: true,
		};
		await expect(
			resolvePaymentTransactionOrder(db, transaction, undefined, {
				merchantId: merchantA,
				environmentId: environmentA,
			}),
		).resolves.toMatchObject({ orderId: "order-attribution-a" });
		await expect(
			resolvePaymentTransactionOrder(db, transaction, undefined, {
				merchantId: merchantB,
				environmentId: environmentB,
			}),
		).resolves.toMatchObject({ orderId: "order-attribution-b" });
	});
});
