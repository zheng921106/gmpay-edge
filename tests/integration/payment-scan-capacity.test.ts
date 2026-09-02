import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	claimPaymentScanLease,
	handlePaymentScan,
	releasePaymentScanLease,
} from "#/server/queue";
import { applyMigrations } from "./migrations";

describe("payment scan capacity controls", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-payment-scan-capacity" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		await seed(db);
	});

	afterAll(async () => miniflare.dispose());

	it("allows only one live consumer to hold an order scan lease", async () => {
		const firstLease = await claimPaymentScanLease(db, "order-lease", 1_000);
		const duplicateLease = await claimPaymentScanLease(
			db,
			"order-lease",
			1_000,
		);

		expect(firstLease).toBe(61_000);
		expect(duplicateLease).toBeNull();
		expect(await claimPaymentScanLease(db, "order-lease", 61_001)).toBe(
			121_001,
		);
		await releasePaymentScanLease(db, "order-lease", firstLease ?? 0);
		const retained = await db
			.prepare(
				"SELECT payment_scan_lease_until FROM orders WHERE id = 'order-lease'",
			)
			.first<{ payment_scan_lease_until: number | null }>();
		expect(retained?.payment_scan_lease_until).toBe(121_001);
	});

	it("acknowledges a duplicate delivery before it loads provider configuration", async () => {
		const lease = await claimPaymentScanLease(
			db,
			"order-duplicate-delivery",
			Date.now(),
		);
		const ack = vi.fn();
		const retry = vi.fn();

		await handlePaymentScan(
			paymentScanMessage("order-duplicate-delivery", ack, retry),
			{ DB: db } as Env,
		);

		expect(lease).not.toBeNull();
		expect(ack).toHaveBeenCalledOnce();
		expect(retry).not.toHaveBeenCalled();
		const auditCount = await db
			.prepare(
				"SELECT COUNT(*) AS count FROM audit_logs WHERE target_id = 'order-duplicate-delivery'",
			)
			.first<{ count: number }>();
		expect(auditCount?.count).toBe(0);
	});

	it("backs off configuration retries and coalesces repeated outage audits", async () => {
		const firstRetry = vi.fn();
		const secondRetry = vi.fn();

		await handlePaymentScan(
			paymentScanMessage("order-retry", vi.fn(), firstRetry, 1),
			{ DB: db } as Env,
		);
		await handlePaymentScan(
			paymentScanMessage("order-retry", vi.fn(), secondRetry, 3),
			{ DB: db } as Env,
		);

		expect(firstRetry).toHaveBeenCalledWith({ delaySeconds: 15 });
		expect(secondRetry).toHaveBeenCalledWith({ delaySeconds: 60 });
		const audits = await db
			.prepare(
				"SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'payment.scan_failed' AND target_id = 'order-retry'",
			)
			.first<{ count: number }>();
		expect(audits?.count).toBe(1);
	});
});

function paymentScanMessage(
	orderId: string,
	ack: ReturnType<typeof vi.fn>,
	retry: ReturnType<typeof vi.fn>,
	attempts = 1,
) {
	return {
		body: {
			kind: "payment.scan" as const,
			version: 1 as const,
			orderId,
			receivingMethodId: "missing-receiving-method",
		},
		attempts,
		ack,
		retry,
	} as unknown as Message<
		import("#/features/payments/types").PaymentScanMessage
	>;
}

async function seed(db: D1Database) {
	const now = Date.now();
	await db.batch([
		db
			.prepare(
				"INSERT INTO payment_rails (code, name, kind, adapter, created_at, updated_at) VALUES ('lease-chain', 'Lease chain', 'chain', 'evm', ?, ?)",
			)
			.bind(now, now),
		db
			.prepare(
				"INSERT INTO payment_assets (id, rail_code, code, symbol, kind, decimals, created_at, updated_at) VALUES ('lease-asset', 'lease-chain', 'LEASE', 'LEASE', 'native', 18, ?, ?)",
			)
			.bind(now, now),
		db
			.prepare(
				`INSERT INTO receiving_methods
				 (id, name, rail_code, target_type, target_value,
				  normalized_target_value, enabled, created_at, updated_at)
				 VALUES ('missing-receiving-method', 'Missing', 'lease-chain', 'address',
				 '0x1111111111111111111111111111111111111111',
				 '0x1111111111111111111111111111111111111111', 1, ?, ?)`,
			)
			.bind(now, now),
		...["order-lease", "order-duplicate-delivery", "order-retry"].flatMap(
			(orderId) => [
				db
					.prepare(
						`INSERT INTO orders
					 (id, external_order_id, status, amount_minor, currency,
					  currency_decimals, payment_asset_id, received_amount_units,
					  expires_at, created_at, updated_at)
					 VALUES (?, ?, 'pending', '100', 'USD', 2, 'lease-asset', '0', ?, ?, ?)`,
					)
					.bind(orderId, orderId, now + 60_000, now, now),
				db
					.prepare(
						`INSERT INTO order_payment_snapshots
					 (order_id, receiving_method_id, receiving_method_name,
					  rail_code, rail_kind, asset_id, asset_code, decimals,
					  target_value, adapter, required_confirmations,
					  expected_amount_units, created_at)
					 VALUES (?, 'missing-receiving-method', 'Missing',
					  'lease-chain', 'chain', 'lease-asset', 'LEASE', 18,
					  '0x1111111111111111111111111111111111111111', 'evm', 1,
					  '1000000000000000000', ?)`,
					)
					.bind(orderId, now),
			],
		),
	]);
}
