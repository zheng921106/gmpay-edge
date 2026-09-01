import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { confirmProductionPaymentTestRun } from "#/features/payment-testing/server/confirmation";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import {
	createPaymentTestFixture,
	provisionProductionTron,
} from "../../helpers/payment-test-fixture";

describe("production payment test confirmation", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;
	let production: Awaited<ReturnType<typeof provisionProductionTron>>;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-confirmation");
		production = await provisionProductionTron({
			db: fixture.db,
			merchantId: fixture.merchant.merchantId,
			environmentId: fixture.merchant.environmentIds.production,
			apiKeyPepper: fixture.apiKeyPepper,
		});
	});

	afterAll(async () => fixture.miniflare.dispose());

	function liveInput(id: string) {
		return {
			protocol: "gmpay" as const,
			paymentMode: "live" as const,
			apiKeyId: production.apiKeyId,
			receivingMethodId: production.receivingMethodId,
			paymentAssetId: production.paymentAssetId,
			amountMinor: "100",
			currency: "USD",
			externalOrderId: `LIVE-${id}`,
			clientIdempotencyKey: `live-${id}`,
			callback: { mode: "builtin" as const },
		};
	}

	it("requires a scoped one-time token before creating a live order", async () => {
		const pending = await startPaymentTestRun(
			fixture.runtime,
			fixture.productionContext,
			liveInput("CONFIRM"),
		);
		expect(pending).toMatchObject({
			confirmationRequired: true,
			confirmationToken: expect.any(String),
			orderId: null,
			status: "ready",
		});
		if (!pending.confirmationToken)
			throw new Error("Production confirmation token was not issued");
		await expect(
			confirmProductionPaymentTestRun(
				fixture.runtime,
				{ ...fixture.productionContext, userId: crypto.randomUUID() },
				{
					runId: pending.runId,
					confirmationToken: pending.confirmationToken,
				},
			),
		).rejects.toMatchObject({ code: "payment_test_confirmation_invalid" });
		await expect(
			confirmProductionPaymentTestRun(
				fixture.runtime,
				fixture.productionContext,
				{
					runId: pending.runId,
					confirmationToken: `${pending.confirmationToken}x`,
				},
			),
		).rejects.toMatchObject({ code: "payment_test_confirmation_invalid" });
		const confirmed = await confirmProductionPaymentTestRun(
			fixture.runtime,
			fixture.productionContext,
			{
				runId: pending.runId,
				confirmationToken: pending.confirmationToken,
			},
		);
		expect(confirmed).toMatchObject({
			confirmationRequired: false,
			orderId: expect.any(String),
			status: "running",
		});
		await expect(
			confirmProductionPaymentTestRun(
				fixture.runtime,
				fixture.productionContext,
				{
					runId: pending.runId,
					confirmationToken: pending.confirmationToken,
				},
			),
		).rejects.toMatchObject({ code: "payment_test_confirmation_invalid" });
	});

	it("rejects expired tokens and changed bound input", async () => {
		const expired = await startPaymentTestRun(
			fixture.runtime,
			fixture.productionContext,
			liveInput("EXPIRED"),
		);
		if (!expired.confirmationToken)
			throw new Error("Production confirmation token was not issued");
		await fixture.db
			.prepare(
				"UPDATE payment_test_runs SET confirmation_expires_at = 1 WHERE id = ?",
			)
			.bind(expired.runId)
			.run();
		await expect(
			confirmProductionPaymentTestRun(
				fixture.runtime,
				fixture.productionContext,
				{
					runId: expired.runId,
					confirmationToken: expired.confirmationToken,
				},
			),
		).rejects.toMatchObject({ code: "payment_test_confirmation_invalid" });

		const changed = await startPaymentTestRun(
			fixture.runtime,
			fixture.productionContext,
			liveInput("CHANGED"),
		);
		if (!changed.confirmationToken)
			throw new Error("Production confirmation token was not issued");
		await fixture.db
			.prepare(
				"UPDATE payment_test_runs SET request_snapshot = replace(request_snapshot, '\"100\"', '\"200\"') WHERE id = ?",
			)
			.bind(changed.runId)
			.run();
		await expect(
			confirmProductionPaymentTestRun(
				fixture.runtime,
				fixture.productionContext,
				{
					runId: changed.runId,
					confirmationToken: changed.confirmationToken,
				},
			),
		).rejects.toMatchObject({ code: "payment_test_confirmation_invalid" });
	});
});
