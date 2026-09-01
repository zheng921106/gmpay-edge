import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handlePaymentTestCallback } from "#/features/payment-testing/server/callback";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import {
	processWebhookMessage,
	type WebhookQueueMessageLike,
} from "#/features/webhooks/server/consumer";
import type { WebhookQueueMessage } from "#/features/webhooks/types";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("built-in payment test callback", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;
	let sequence = 0;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-callback");
	});

	afterAll(async () => fixture.miniflare.dispose());

	async function readyDelivery(
		protocol: "gmpay" | "epay",
		expectedOutcome: "paid" | "callback_retry_succeeded" = "paid",
		requestOrigin = fixture.sandboxContext.requestOrigin,
	) {
		sequence += 1;
		const run = await startPaymentTestRun(
			fixture.runtime,
			{ ...fixture.sandboxContext, requestOrigin },
			{
				protocol,
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: String(500 + sequence),
				currency: protocol === "epay" ? "CNY" : "USD",
				externalOrderId: `CALLBACK-${protocol}-${sequence}`,
				clientIdempotencyKey: `callback-${protocol}-${sequence}`,
				callback: { mode: "builtin" },
				expectedOutcome,
			},
		);
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId: run.runId,
			scenario:
				expectedOutcome === "callback_retry_succeeded"
					? "callback_failure_then_retry"
					: "exact_success",
			step: 1,
		});
		const delivery = await fixture.db
			.prepare(
				`SELECT delivery.id, delivery.event_id, order_record.notify_url
				 FROM payment_test_runs run
				 JOIN orders order_record ON order_record.id = run.order_id
				 JOIN webhook_deliveries delivery ON delivery.order_id = order_record.id
				 WHERE run.id = ? ORDER BY delivery.created_at DESC, delivery.id DESC LIMIT 1`,
			)
			.bind(run.runId)
			.first<{ id: string; event_id: string; notify_url: string }>();
		if (!delivery) throw new Error("Callback delivery was not created");
		return { run, delivery };
	}

	function message(
		delivery: { id: string; event_id: string },
		attempt: number,
	) {
		const ack = vi.fn();
		const retry = vi.fn();
		const body: WebhookQueueMessage = {
			kind: "webhook.delivery",
			version: 1,
			deliveryId: delivery.id,
			eventId: delivery.event_id,
			attempt,
		};
		return {
			ack,
			retry,
			value: {
				body,
				attempts: attempt,
				id: `callback-request-${delivery.id}-${attempt}`,
				ack,
				retry,
			} satisfies WebhookQueueMessageLike,
		};
	}

	const receiver = (input: URL | RequestInfo, init?: RequestInit) =>
		handlePaymentTestCallback(new Request(input, init), { DB: fixture.db });

	it.each([
		["gmpay", "ok"],
		["epay", "success"],
	] as const)("acknowledges a signed %s callback", async (protocol, ack) => {
		const { delivery } = await readyDelivery(protocol);
		const queued = message(delivery, 1);
		const result = await processWebhookMessage(
			fixture.db,
			queued.value,
			receiver,
		);
		expect(result).toMatchObject({ success: true, responseExcerpt: ack });
		expect(queued.ack).toHaveBeenCalledOnce();
		const receipt = await fixture.db
			.prepare(
				`SELECT receipt.signature_status, receipt.response_acknowledgement,
				 receipt.attempt, run.status
				 FROM payment_test_callback_receipts receipt
				 JOIN payment_test_runs run ON run.id = receipt.run_id
				 WHERE receipt.delivery_id = ?`,
			)
			.bind(delivery.id)
			.first<{
				signature_status: string;
				response_acknowledgement: string;
				attempt: number;
				status: string;
			}>();
		expect(receipt).toEqual({
			signature_status: "valid",
			response_acknowledgement: ack,
			attempt: 1,
			status: "passed",
		});
	});

	it("records one receipt for a duplicate delivery attempt", async () => {
		const { delivery } = await readyDelivery("gmpay");
		const queued = message(delivery, 1);
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const capture = async (input: URL | RequestInfo, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedInit = init;
			return handlePaymentTestCallback(new Request(input, init), {
				DB: fixture.db,
			});
		};
		await processWebhookMessage(fixture.db, queued.value, capture);
		if (!(capturedUrl && capturedInit))
			throw new Error("Callback request was not captured");
		await expect(
			handlePaymentTestCallback(new Request(capturedUrl, capturedInit), {
				DB: fixture.db,
			}),
		).resolves.toMatchObject({ status: 200 });
		const count = await fixture.db
			.prepare(
				"SELECT COUNT(*) AS count FROM payment_test_callback_receipts WHERE delivery_id = ? AND attempt = 1",
			)
			.bind(delivery.id)
			.first<{ count: number }>();
		expect(count?.count).toBe(1);
	});

	it("keeps the run active after failure and passes on a signed retry", async () => {
		const { run, delivery } = await readyDelivery(
			"gmpay",
			"callback_retry_succeeded",
		);
		const first = message(delivery, 1);
		await processWebhookMessage(
			fixture.db,
			first.value,
			vi.fn().mockResolvedValue(new Response("failure", { status: 500 })),
		);
		await expect(runStatus(run.runId)).resolves.toBe("running");
		const second = message(delivery, 2);
		await processWebhookMessage(fixture.db, second.value, receiver);
		await expect(runStatus(run.runId)).resolves.toBe("passed");
	});

	it("allows an active callback on the authoritative local instance origin", async () => {
		await fixture.db
			.prepare(
				"UPDATE system_settings SET value = ? WHERE key = 'runtime.better_auth_url'",
			)
			.bind(JSON.stringify("http://127.0.0.1:8787"))
			.run();
		try {
			const { run, delivery } = await readyDelivery(
				"gmpay",
				"paid",
				"http://127.0.0.1:8787",
			);
			expect(delivery.notify_url).toMatch(
				/^http:\/\/127\.0\.0\.1:8787\/api\/test-callbacks\//,
			);
			const queued = message(delivery, 1);
			await expect(
				processWebhookMessage(fixture.db, queued.value, receiver),
			).resolves.toMatchObject({ success: true });
			await expect(runStatus(run.runId)).resolves.toBe("passed");
		} finally {
			await fixture.db
				.prepare(
					"UPDATE system_settings SET value = ? WHERE key = 'runtime.better_auth_url'",
				)
				.bind(JSON.stringify("https://pay.example"))
				.run();
		}
	});

	async function runStatus(runId: string) {
		return (
			await fixture.db
				.prepare("SELECT status FROM payment_test_runs WHERE id = ?")
				.bind(runId)
				.first<{ status: string }>()
		)?.status;
	}
});
