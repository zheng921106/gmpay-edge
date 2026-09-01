import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { preflightPaymentTest } from "#/features/payment-testing/server/preflight";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("payment test scope isolation", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-isolation");
	});

	afterAll(async () => fixture.miniflare.dispose());

	function input() {
		return {
			protocol: "gmpay" as const,
			paymentMode: "simulator" as const,
			apiKeyId: fixture.preset.apiKeyId,
			receivingMethodId: fixture.preset.receivingMethodId,
			paymentAssetId: fixture.preset.paymentAssetId,
			amountMinor: "100",
			currency: "USD",
			externalOrderId: "ISOLATION-001",
			clientIdempotencyKey: "isolation-001",
			callback: { mode: "builtin" as const },
		};
	}

	it("rejects foreign credentials and receiving resources before order creation", async () => {
		await expect(
			preflightPaymentTest(fixture.db, fixture.sandboxContext, {
				...input(),
				apiKeyId: crypto.randomUUID(),
			}),
		).rejects.toMatchObject({ code: "payment_test_resource_not_found" });
		await expect(
			preflightPaymentTest(fixture.db, fixture.sandboxContext, {
				...input(),
				receivingMethodId: crypto.randomUUID(),
			}),
		).rejects.toMatchObject({ code: "payment_test_resource_not_found" });
		expect(
			await fixture.db.prepare("SELECT COUNT(*) AS count FROM orders").first(),
		).toEqual({ count: 0 });
	});

	it("rejects environment-mode mismatches and unsafe callbacks", async () => {
		await expect(
			preflightPaymentTest(fixture.db, fixture.sandboxContext, {
				...input(),
				paymentMode: "live",
			}),
		).rejects.toMatchObject({ code: "payment_mode_environment_mismatch" });
		await expect(
			preflightPaymentTest(fixture.db, fixture.sandboxContext, {
				...input(),
				callback: { mode: "custom", url: "https://127.0.0.1/callback" },
			}),
		).rejects.toMatchObject({ code: "payment_test_callback_unsafe" });
	});

	it("requires runtime queues without creating a partial run", async () => {
		await expect(
			startPaymentTestRun({ DB: fixture.db }, fixture.sandboxContext, input()),
		).rejects.toMatchObject({ code: "payment_test_queue_unavailable" });
		expect(
			await fixture.db
				.prepare("SELECT COUNT(*) AS count FROM payment_test_runs")
				.first(),
		).toEqual({ count: 0 });
	});
});
