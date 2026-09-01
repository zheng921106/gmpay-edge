import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import { loadPaymentTestTimeline } from "#/features/payment-testing/server/timeline";
import {
	processWebhookMessage,
	type WebhookQueueMessageLike,
} from "#/features/webhooks/server/consumer";
import type { WebhookQueueMessage } from "#/features/webhooks/types";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("payment test evidence timeline", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;
	let runId: string;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-timeline");
		const run = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			{
				protocol: "gmpay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "777",
				currency: "USD",
				externalOrderId: "TIMELINE-001",
				clientIdempotencyKey: "timeline-001",
				callback: { mode: "builtin" },
			},
		);
		runId = run.runId;
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId,
			scenario: "confirmation_progression",
			step: 1,
		});
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId,
			scenario: "confirmation_progression",
			step: 2,
		});
	});

	afterAll(async () => fixture.miniflare.dispose());

	it("composes scoped domain evidence in deterministic chronological order", async () => {
		const timeline = await loadPaymentTestTimeline(
			fixture.db,
			fixture.sandboxContext,
			runId,
		);
		expect(timeline.run).toMatchObject({
			id: runId,
			protocol: "gmpay",
			mode: "simulator",
			orderStatus: "paid",
		});
		expect(timeline.events.map((event) => event.kind)).toEqual(
			expect.arrayContaining([
				"run.created",
				"order.created",
				"payment.observed",
				"webhook.event",
				"webhook.delivery",
				"audit.recorded",
			]),
		);
		for (let index = 1; index < timeline.events.length; index += 1) {
			const previous = timeline.events[index - 1];
			const current = timeline.events[index];
			if (!(previous && current)) continue;
			expect(
				previous.occurredAt < current.occurredAt ||
					(previous.occurredAt === current.occurredAt &&
						(previous.priority < current.priority ||
							(previous.priority === current.priority &&
								previous.id.localeCompare(current.id) <= 0))),
			).toBe(true);
		}
	});

	it("does not reveal another merchant's run", async () => {
		await expect(
			loadPaymentTestTimeline(
				fixture.db,
				{ ...fixture.sandboxContext, merchantId: crypto.randomUUID() },
				runId,
			),
		).rejects.toMatchObject({ code: "payment_test_run_not_found" });
	});

	it("records custom callback evidence and reconciles success immediately", async () => {
		const custom = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			{
				protocol: "gmpay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "778",
				currency: "USD",
				externalOrderId: "TIMELINE-CUSTOM",
				clientIdempotencyKey: "timeline-custom-001",
				callback: { mode: "custom", url: "https://example.com/hook" },
			},
		);
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId: custom.runId,
			scenario: "exact_success",
			step: 1,
		});
		const delivery = await fixture.db
			.prepare(
				`SELECT delivery.id, delivery.event_id FROM webhook_deliveries delivery
				 JOIN payment_test_runs run ON run.order_id = delivery.order_id
				 WHERE run.id = ? ORDER BY delivery.created_at DESC LIMIT 1`,
			)
			.bind(custom.runId)
			.first<{ id: string; event_id: string }>();
		if (!delivery) throw new Error("Custom callback delivery was not created");
		const body: WebhookQueueMessage = {
			kind: "webhook.delivery",
			version: 1,
			deliveryId: delivery.id,
			eventId: delivery.event_id,
			attempt: 1,
		};
		const message = {
			body,
			attempts: 1,
			id: "timeline-custom-attempt",
			ack() {},
			retry() {},
		} satisfies WebhookQueueMessageLike;
		await processWebhookMessage(
			fixture.db,
			message,
			async () => new Response("ok", { status: 200 }),
		);
		const status = await fixture.db
			.prepare("SELECT status FROM payment_test_runs WHERE id = ?")
			.bind(custom.runId)
			.first<{ status: string }>();
		expect(status?.status).toBe("passed");
		const timeline = await loadPaymentTestTimeline(
			fixture.db,
			fixture.sandboxContext,
			custom.runId,
		);
		expect(timeline.events.map((event) => event.kind)).toContain(
			"webhook.attempt",
		);
	});
});
