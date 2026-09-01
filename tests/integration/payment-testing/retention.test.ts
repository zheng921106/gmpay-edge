import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runOperationalRetentionCleanup } from "#/features/operations/server/operational-retention";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 8, 1);
const OLD = NOW - 31 * DAY_MS;

describe("payment test evidence retention", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-retention");
	});

	afterAll(async () => fixture.miniflare.dispose());

	it("deletes receipts before terminal runs without deleting domain records", async () => {
		const started = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			{
				protocol: "gmpay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "100",
				currency: "USD",
				externalOrderId: "retention-order",
				clientIdempotencyKey: "retention-run-001",
				callback: { mode: "builtin" },
			},
		);
		if (!started.orderId) throw new Error("Expected test order");
		const eventId = crypto.randomUUID();
		const deliveryId = crypto.randomUUID();
		await fixture.db.batch([
			fixture.db
				.prepare(
					"UPDATE payment_test_runs SET status = 'passed', completed_at = ?, updated_at = ? WHERE id = ?",
				)
				.bind(OLD, OLD, started.runId),
			fixture.db
				.prepare(
					"INSERT INTO webhook_events (id, order_id, type, deduplication_key, payload, created_at, updated_at) VALUES (?, ?, 'order.paid', ?, '{}', ?, ?)",
				)
				.bind(eventId, started.orderId, `retention:${eventId}`, NOW, NOW),
			fixture.db
				.prepare(
					"INSERT INTO webhook_deliveries (id, event_id, order_id, api_key_id, status, attempt_count, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?, ?)",
				)
				.bind(
					deliveryId,
					eventId,
					started.orderId,
					fixture.preset.apiKeyId,
					NOW,
					NOW,
					NOW,
				),
		]);
		await fixture.db
			.prepare(
				`INSERT INTO payment_test_callback_receipts
				 (id, run_id, event_id, delivery_id, attempt, signature_status,
				 request_headers, request_body, response_acknowledgement,
				 received_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 1, 'valid', '{}', '{}', 'ok', ?, ?, ?)`,
			)
			.bind(
				crypto.randomUUID(),
				started.runId,
				eventId,
				deliveryId,
				OLD,
				OLD,
				OLD,
			)
			.run();

		const result = await runOperationalRetentionCleanup({
			db: fixture.db,
			bucket: { delete: vi.fn().mockResolvedValue(undefined) },
			now: NOW,
			retentionMs: 365 * DAY_MS,
			testEvidenceRetentionMs: 30 * DAY_MS,
		});

		expect(result.testEvidenceRows).toBe(2);
		await expect(count("payment_test_callback_receipts")).resolves.toBe(0);
		await expect(count("payment_test_runs")).resolves.toBe(0);
		await expect(count("orders")).resolves.toBe(1);
		await expect(count("webhook_events")).resolves.toBe(1);
		await expect(count("webhook_deliveries")).resolves.toBe(1);
	});

	async function count(table: string) {
		return (
			(await fixture.db
				.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
				.first<number>("count")) ?? 0
		);
	}
});
