import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("payment test simulator scenarios", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;
	let sequence = 0;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-simulator");
	});

	afterAll(async () => fixture.miniflare.dispose());

	async function createRun(label: string) {
		sequence += 1;
		return startPaymentTestRun(fixture.runtime, fixture.sandboxContext, {
			protocol: "gmpay",
			paymentMode: "simulator",
			apiKeyId: fixture.preset.apiKeyId,
			receivingMethodId: fixture.preset.receivingMethodId,
			paymentAssetId: fixture.preset.paymentAssetId,
			amountMinor: String(100 + sequence),
			currency: "USD",
			externalOrderId: `SIM-${label}-${sequence}`,
			clientIdempotencyKey: `sim-${label}-${sequence}`,
			callback: { mode: "builtin" },
		});
	}

	it("settles an exact payment with deterministic duplicate handling", async () => {
		const run = await createRun("EXACT");
		const first = await advanceSimulatorScenario(
			fixture.runtime,
			fixture.sandboxContext,
			{ runId: run.runId, scenario: "exact_success", step: 1 },
		);
		expect(first).toEqual({
			runId: run.runId,
			orderStatus: "paid",
			duplicate: false,
		});
		const repeated = await advanceSimulatorScenario(
			fixture.runtime,
			fixture.sandboxContext,
			{ runId: run.runId, scenario: "exact_success", step: 1 },
		);
		expect(repeated).toEqual({ ...first, duplicate: true });
		const state = await fixture.db
			.prepare(
				`SELECT run.scenario, run.scenario_step, COUNT(payment.id) AS payments,
				 COUNT(DISTINCT payment.transaction_id) AS transaction_ids
				 FROM payment_test_runs run
				 LEFT JOIN order_payments payment ON payment.order_id = run.order_id
				 WHERE run.id = ? GROUP BY run.id`,
			)
			.bind(run.runId)
			.first<{
				scenario: string;
				scenario_step: number;
				payments: number;
				transaction_ids: number;
			}>();
		expect(state).toEqual({
			scenario: "exact_success",
			scenario_step: 1,
			payments: 1,
			transaction_ids: 1,
		});
	});

	it("accumulates a partial payment before completion", async () => {
		const run = await createRun("PARTIAL");
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: run.runId,
				scenario: "partial_then_complete",
				step: 1,
			}),
		).resolves.toMatchObject({ orderStatus: "partially_paid" });
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: run.runId,
				scenario: "partial_then_complete",
				step: 2,
			}),
		).resolves.toMatchObject({ orderStatus: "paid" });
	});

	it("supports overpayment and a failed provider observation", async () => {
		const overpaid = await createRun("OVERPAID");
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: overpaid.runId,
				scenario: "overpayment",
				step: 1,
			}),
		).resolves.toMatchObject({ orderStatus: "overpaid" });

		const failed = await createRun("FAILED");
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: failed.runId,
				scenario: "failed_transaction",
				step: 1,
			}),
		).resolves.toMatchObject({ orderStatus: "pending" });
		const payment = await fixture.db
			.prepare("SELECT status FROM order_payments WHERE order_id = ? LIMIT 1")
			.bind(failed.orderId)
			.first<{ status: string }>();
		expect(payment?.status).toBe("rejected");
	});

	it("advances confirmations on one transaction", async () => {
		const run = await createRun("CONFIRMATIONS");
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: run.runId,
				scenario: "confirmation_progression",
				step: 1,
			}),
		).resolves.toMatchObject({ orderStatus: "confirming" });
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: run.runId,
				scenario: "confirmation_progression",
				step: 2,
			}),
		).resolves.toMatchObject({ orderStatus: "paid" });
		const count = await fixture.db
			.prepare(
				"SELECT COUNT(*) AS count FROM order_payments WHERE order_id = ?",
			)
			.bind(run.orderId)
			.first<{ count: number }>();
		expect(count?.count).toBe(1);
	});

	it("expires through the real expiry flow before recording a late payment", async () => {
		const run = await createRun("LATE");
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId: run.runId,
				scenario: "late_payment",
				step: 1,
			}),
		).resolves.toMatchObject({ orderStatus: "expired" });
		const events = await fixture.db
			.prepare(
				"SELECT type FROM webhook_events WHERE order_id = ? ORDER BY created_at, rowid",
			)
			.bind(run.orderId)
			.all<{ type: string }>();
		expect(events.results.map((event) => event.type)).toEqual([
			"order.expired",
			"payment.late_detected",
		]);
	});

	it("rolls back and recovers one canonical transaction", async () => {
		const run = await createRun("REORG");
		for (const [step, status] of [
			[1, "paid"],
			[2, "pending"],
			[3, "paid"],
		] as const) {
			await expect(
				advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
					runId: run.runId,
					scenario: "reorg_then_recover",
					step,
				}),
			).resolves.toMatchObject({ orderStatus: status });
		}
		const transaction = await fixture.db
			.prepare(
				`SELECT payment.status, chain.status AS chain_status
				 FROM order_payments payment JOIN blockchain_transactions chain
				 ON payment.transaction_id = chain.network || ':' || chain.tx_hash || ':' || chain.event_index
				 WHERE payment.order_id = ?`,
			)
			.bind(run.orderId)
			.first<{ status: string; chain_status: string }>();
		expect(transaction).toEqual({
			status: "confirmed",
			chain_status: "confirmed",
		});
	});

	it.each([
		"duplicate_delivery",
		"callback_failure_then_retry",
	] as const)("creates a deterministic payment and callback delivery for %s", async (scenario) => {
		const run = await createRun(scenario);
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId: run.runId,
			scenario,
			step: 1,
		});
		const delivery = await fixture.db
			.prepare(
				`SELECT delivery.status FROM webhook_deliveries delivery
					 JOIN payment_test_runs run ON run.order_id = delivery.order_id
					 WHERE run.id = ? ORDER BY delivery.created_at DESC LIMIT 1`,
			)
			.bind(run.runId)
			.first<{ status: string }>();
		expect(delivery?.status).toBe("queued");
	});
});
