import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signGmpayParameters } from "#/features/api-keys/server/gmpay-signature";
import { handlePaymentTestCallback } from "#/features/payment-testing/server/callback";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("built-in payment test callback security", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;
	let callback: {
		runId: string;
		url: string;
		eventId: string;
		deliveryId: string;
	};

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-callback-security");
		const run = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			{
				protocol: "gmpay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "880",
				currency: "USD",
				externalOrderId: "CALLBACK-SECURITY",
				clientIdempotencyKey: "callback-security-001",
				callback: { mode: "builtin" },
			},
		);
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId: run.runId,
			scenario: "exact_success",
			step: 1,
		});
		const row = await fixture.db
			.prepare(
				`SELECT order_record.notify_url, event.id AS event_id, delivery.id AS delivery_id
				 FROM payment_test_runs run JOIN orders order_record ON order_record.id = run.order_id
				 JOIN webhook_events event ON event.order_id = order_record.id
				 JOIN webhook_deliveries delivery ON delivery.event_id = event.id
				 WHERE run.id = ? ORDER BY delivery.created_at DESC LIMIT 1`,
			)
			.bind(run.runId)
			.first<{
				notify_url: string;
				event_id: string;
				delivery_id: string;
			}>();
		if (!row) throw new Error("Callback fixture is incomplete");
		callback = {
			runId: run.runId,
			url: row.notify_url,
			eventId: row.event_id,
			deliveryId: row.delivery_id,
		};
	});

	afterAll(async () => fixture.miniflare.dispose());

	function callbackRequest(url: string, body: string) {
		return new Request(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-gmpay-event-id": callback.eventId,
				"x-gmpay-delivery-id": callback.deliveryId,
				"x-gmpay-attempt": "1",
			},
			body,
		});
	}

	it("uses one generic response for invalid and expired tokens", async () => {
		const invalid = await handlePaymentTestCallback(
			callbackRequest(`${callback.url}invalid`, "{}"),
			{ DB: fixture.db },
		);
		await fixture.db
			.prepare(
				"UPDATE payment_test_runs SET callback_token_expires_at = 1 WHERE id = ?",
			)
			.bind(callback.runId)
			.run();
		const expired = await handlePaymentTestCallback(
			callbackRequest(callback.url, "{}"),
			{ DB: fixture.db },
		);
		expect({ status: invalid.status, body: await invalid.text() }).toEqual({
			status: expired.status,
			body: await expired.text(),
		});
		await fixture.db
			.prepare(
				"UPDATE payment_test_runs SET callback_token_expires_at = ? WHERE id = ?",
			)
			.bind(Date.now() + 60_000, callback.runId)
			.run();
	});

	it("rejects invalid signatures without storing secrets", async () => {
		const response = await handlePaymentTestCallback(
			callbackRequest(
				callback.url,
				JSON.stringify({
					pid: fixture.merchant.sandboxCredential.pid,
					status: 2,
					signature: "0".repeat(64),
					secret: fixture.merchant.sandboxCredential.secret,
				}),
			),
			{ DB: fixture.db },
		);
		expect(response.status).toBe(400);
		const receipt = await fixture.db
			.prepare(
				"SELECT signature_status, request_body FROM payment_test_callback_receipts WHERE delivery_id = ? AND attempt = 1",
			)
			.bind(callback.deliveryId)
			.first<{ signature_status: string; request_body: string }>();
		expect(receipt?.signature_status).toBe("invalid");
		expect(receipt?.request_body).toContain("[REDACTED]");
		expect(receipt?.request_body).not.toContain(
			fixture.merchant.sandboxCredential.secret,
		);
	});

	it("rejects oversized callback bodies before parsing", async () => {
		const response = await handlePaymentTestCallback(
			callbackRequest(callback.url, `{"padding":"${"x".repeat(70_000)}"}`),
			{ DB: fixture.db },
		);
		expect(response.status).toBe(400);
	});

	it("accepts only a valid constant-time signature for the scoped delivery", async () => {
		await fixture.db
			.prepare(
				"DELETE FROM payment_test_callback_receipts WHERE delivery_id = ? AND attempt = 1",
			)
			.bind(callback.deliveryId)
			.run();
		const parameters = {
			pid: fixture.merchant.sandboxCredential.pid,
			trade_id: "callback-security",
			status: 2,
		};
		const response = await handlePaymentTestCallback(
			callbackRequest(
				callback.url,
				JSON.stringify({
					...parameters,
					signature: signGmpayParameters(
						parameters,
						fixture.merchant.sandboxCredential.secret,
					),
				}),
			),
			{ DB: fixture.db },
		);
		expect(response).toMatchObject({ status: 200 });
		expect(await response.text()).toBe("ok");
	});
});
