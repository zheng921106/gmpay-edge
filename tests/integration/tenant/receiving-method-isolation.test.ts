import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteReceivingMethod } from "#/features/payment-settings/server/delete-receiving-method";
import { listReceivingMethods } from "#/features/payment-settings/server/methods";
import { applyMigrations } from "../migrations";

const merchantA = {
	merchantId: "merchant-a",
	environmentId: "merchant-a-production",
	environment: "production" as const,
};
const merchantB = {
	merchantId: "merchant-b",
	environmentId: "merchant-b-production",
	environment: "production" as const,
};

describe("merchant receiving-method isolation", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-receiving-method-isolation" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		await seed(db);
	});

	afterAll(async () => miniflare.dispose());

	it("lists only receiving methods from the selected merchant environment", async () => {
		await expect(listReceivingMethods(db, merchantA)).resolves.toMatchObject([
			{ id: "method-a", name: "Merchant A USDT" },
		]);
		await expect(listReceivingMethods(db, merchantB)).resolves.toMatchObject([
			{ id: "method-b", name: "Merchant B USDT" },
		]);
	});

	it("does not delete a receiving method outside the selected merchant environment", async () => {
		await expect(
			deleteReceivingMethod(db, "method-b", emptyAudit, merchantA),
		).rejects.toMatchObject({
			code: "receiving_method_not_found",
			status: 404,
		});
		await expect(
			db
				.prepare("SELECT id FROM receiving_methods WHERE id = 'method-b'")
				.first(),
		).resolves.toEqual({ id: "method-b" });
	});

	it("updates only the selected merchant address and preserves existing order snapshots", async () => {
		const methodsModule = await import(
			"#/features/payment-settings/server/methods"
		);
		const updateReceivingMethod = Reflect.get(
			methodsModule,
			"updateReceivingMethod",
		) as
			| ((
					db: D1Database,
					input: {
						id: string;
						name: string;
						address: string;
					},
					audit: typeof emptyAudit,
					scope: typeof merchantA,
			  ) => Promise<unknown>)
			| undefined;
		expect(typeof updateReceivingMethod).toBe("function");
		if (!updateReceivingMethod) return;

		await updateReceivingMethod(
			db,
			{
				id: "method-a",
				name: "Merchant A USDT",
				address: "TA-new",
			},
			emptyAudit,
			merchantA,
		);

		await expect(
			db
				.prepare(
					`SELECT
					 (SELECT target_value FROM receiving_methods WHERE id = 'method-a') AS method_a_target,
					 (SELECT target_value FROM receiving_methods WHERE id = 'method-b') AS method_b_target,
					 (SELECT target_value FROM order_payment_snapshots WHERE order_id = 'order-a') AS snapshot_target`,
				)
				.first(),
		).resolves.toEqual({
			method_a_target: "TA-new",
			method_b_target: "TB",
			snapshot_target: "TA",
		});
	});
});

const emptyAudit = {
	actorUserId: null,
	requestId: null,
	ipAddress: null,
};

async function seed(db: D1Database) {
	const now = Date.now();
	await db.batch([
		db
			.prepare(
				`INSERT INTO merchants (id, slug, name, status, created_at, updated_at) VALUES
				 ('merchant-a', 'merchant-a', 'Merchant A', 'active', ?, ?),
				 ('merchant-b', 'merchant-b', 'Merchant B', 'active', ?, ?)`,
			)
			.bind(now, now, now, now),
		db
			.prepare(
				`INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES
				 ('merchant-a-production', 'merchant-a', 'production', 'active', ?, ?),
				 ('merchant-b-production', 'merchant-b', 'production', 'active', ?, ?)`,
			)
			.bind(now, now, now, now),
		db
			.prepare(
				"INSERT INTO payment_rails (code, name, kind, adapter, created_at, updated_at) VALUES ('tron', 'TRON', 'chain', 'tron', ?, ?)",
			)
			.bind(now, now),
		db
			.prepare(
				"INSERT INTO payment_assets (id, rail_code, code, symbol, kind, decimals, default_confirmations, created_at, updated_at) VALUES ('tron-usdt', 'tron', 'USDT', 'USDT', 'token', 6, 20, ?, ?)",
			)
			.bind(now, now),
		db
			.prepare(
				`INSERT INTO receiving_methods
				 (id, merchant_id, environment_id, name, rail_code, target_type, target_value, normalized_target_value, enabled, created_at, updated_at)
				 VALUES
				 ('method-a', 'merchant-a', 'merchant-a-production', 'Merchant A USDT', 'tron', 'address', 'TA', 'ta', 1, ?, ?),
				 ('method-b', 'merchant-b', 'merchant-b-production', 'Merchant B USDT', 'tron', 'address', 'TB', 'tb', 1, ?, ?)`,
			)
			.bind(now, now, now, now),
		db
			.prepare(
				"INSERT INTO orders (id, merchant_id, environment_id, external_order_id, status, amount_minor, currency, currency_decimals, payment_asset_id, received_amount_units, expires_at, created_at, updated_at) VALUES ('order-a', 'merchant-a', 'merchant-a-production', 'external-a', 'pending', '100', 'USD', 2, 'tron-usdt', '0', ?, ?, ?)",
			)
			.bind(now + 900_000, now, now),
		db
			.prepare(
				"INSERT INTO order_payment_snapshots (order_id, receiving_method_id, receiving_method_name, rail_code, rail_kind, asset_id, asset_code, decimals, target_value, adapter, required_confirmations, expected_amount_units, created_at) VALUES ('order-a', 'method-a', 'Merchant A USDT', 'tron', 'chain', 'tron-usdt', 'USDT', 6, 'TA', 'tron', 20, '1000000', ?)",
			)
			.bind(now),
	]);
}
