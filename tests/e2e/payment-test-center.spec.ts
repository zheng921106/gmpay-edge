import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handlePaymentTestCallback } from "#/features/payment-testing/server/callback";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import { loadPaymentTestTimeline } from "#/features/payment-testing/server/timeline";
import {
	processWebhookMessage,
	type WebhookQueueMessageLike,
} from "#/features/webhooks/server/consumer";
import type { WebhookQueueMessage } from "#/features/webhooks/types";
import { createPaymentTestFixture } from "../helpers/payment-test-fixture";

describe("payment test center closed loop", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-center-e2e");
	});

	afterAll(async () => fixture.miniflare.dispose());

	it("completes an EPay simulator run after a failed callback and retry", async () => {
		const run = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			{
				protocol: "epay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "900",
				currency: "CNY",
				externalOrderId: "E2E-EPAY-RETRY",
				clientIdempotencyKey: "e2e-epay-retry-001",
				callback: { mode: "builtin" },
				expectedOutcome: "callback_retry_succeeded",
			},
		);
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId: run.runId,
			scenario: "callback_failure_then_retry",
			step: 1,
		});
		const delivery = await fixture.db
			.prepare(
				`SELECT delivery.id, delivery.event_id
				 FROM payment_test_runs run
				 JOIN webhook_deliveries delivery ON delivery.order_id = run.order_id
				 WHERE run.id = ? ORDER BY delivery.created_at DESC LIMIT 1`,
			)
			.bind(run.runId)
			.first<{ id: string; event_id: string }>();
		if (!delivery) throw new Error("Expected callback delivery");

		await processWebhookMessage(
			fixture.db,
			message(delivery, 1),
			vi.fn().mockResolvedValue(new Response("failure", { status: 500 })),
		);
		await processWebhookMessage(
			fixture.db,
			message(delivery, 2),
			(input, init) =>
				handlePaymentTestCallback(new Request(input, init), { DB: fixture.db }),
		);

		const detail = await loadPaymentTestTimeline(
			fixture.db,
			fixture.sandboxContext,
			run.runId,
		);
		expect(detail.run).toMatchObject({
			protocol: "epay",
			mode: "simulator",
			status: "passed",
		});
		expect(detail.events.map((event) => event.kind)).toEqual(
			expect.arrayContaining([
				"order.created",
				"payment.observed",
				"webhook.delivery",
				"webhook.attempt",
				"callback.received",
			]),
		);
	});
});

function message(
	delivery: { id: string; event_id: string },
	attempt: number,
): WebhookQueueMessageLike {
	const body: WebhookQueueMessage = {
		kind: "webhook.delivery",
		version: 1,
		deliveryId: delivery.id,
		eventId: delivery.event_id,
		attempt,
	};
	return {
		body,
		attempts: attempt,
		id: `e2e-${delivery.id}-${attempt}`,
		ack: vi.fn(),
		retry: vi.fn(),
	};
}
