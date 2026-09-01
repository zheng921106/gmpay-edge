import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("payment test simulator access", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;
	let runId: string;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-simulator-access");
		const run = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			{
				protocol: "gmpay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "991",
				currency: "USD",
				externalOrderId: "SIM-ACCESS",
				clientIdempotencyKey: "sim-access-001",
				callback: { mode: "builtin" },
			},
		);
		runId = run.runId;
	});

	afterAll(async () => fixture.miniflare.dispose());

	async function paymentCount() {
		return (
			await fixture.db
				.prepare("SELECT COUNT(*) AS count FROM order_payments")
				.first<{ count: number }>()
		)?.count;
	}

	it("fails closed for foreign scope before payment mutation", async () => {
		const before = await paymentCount();
		await expect(
			advanceSimulatorScenario(
				fixture.runtime,
				{ ...fixture.sandboxContext, merchantId: crypto.randomUUID() },
				{ runId, scenario: "exact_success", step: 1 },
			),
		).rejects.toMatchObject({ code: "payment_test_run_not_found" });
		expect(await paymentCount()).toBe(before);
	});

	it("rejects production mode and non-simulator snapshots", async () => {
		const before = await paymentCount();
		await fixture.db
			.prepare(
				"UPDATE payment_test_runs SET payment_mode = 'live' WHERE id = ?",
			)
			.bind(runId)
			.run();
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId,
				scenario: "exact_success",
				step: 1,
			}),
		).rejects.toMatchObject({ code: "payment_mode_environment_mismatch" });
		await fixture.db
			.prepare(
				"UPDATE payment_test_runs SET payment_mode = 'simulator' WHERE id = ?",
			)
			.bind(runId)
			.run();
		await fixture.db
			.prepare(
				"UPDATE order_payment_snapshots SET adapter = 'tron' WHERE order_id = (SELECT order_id FROM payment_test_runs WHERE id = ?)",
			)
			.bind(runId)
			.run();
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId,
				scenario: "exact_success",
				step: 1,
			}),
		).rejects.toMatchObject({ code: "payment_test_simulator_unavailable" });
		expect(await paymentCount()).toBe(before);
	});

	it("rejects skipped steps and scenario changes", async () => {
		await fixture.db
			.prepare(
				"UPDATE order_payment_snapshots SET adapter = 'simulator' WHERE order_id = (SELECT order_id FROM payment_test_runs WHERE id = ?)",
			)
			.bind(runId)
			.run();
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId,
				scenario: "partial_then_complete",
				step: 2,
			}),
		).rejects.toMatchObject({ code: "payment_test_scenario_step_invalid" });
		await advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
			runId,
			scenario: "partial_then_complete",
			step: 1,
		});
		await expect(
			advanceSimulatorScenario(fixture.runtime, fixture.sandboxContext, {
				runId,
				scenario: "overpayment",
				step: 1,
			}),
		).rejects.toMatchObject({ code: "payment_test_scenario_conflict" });
	});
});
