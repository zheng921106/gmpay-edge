import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("signed payment test protocol runs", () => {
	let fixture: Awaited<ReturnType<typeof createPaymentTestFixture>>;

	beforeAll(async () => {
		fixture = await createPaymentTestFixture("payment-test-protocol");
	});

	afterAll(async () => fixture.miniflare.dispose());

	it.each([
		"gmpay",
		"epay",
	] as const)("invokes the real %s handler and stores redacted evidence", async (protocol) => {
		const input = {
			protocol,
			paymentMode: "simulator" as const,
			apiKeyId: fixture.preset.apiKeyId,
			receivingMethodId: fixture.preset.receivingMethodId,
			paymentAssetId: fixture.preset.paymentAssetId,
			amountMinor: "100",
			currency: protocol === "epay" ? "CNY" : "USD",
			externalOrderId: `TEST-${protocol.toUpperCase()}-001`,
			clientIdempotencyKey: `test-${protocol}-001`,
			callback: { mode: "builtin" as const },
		};
		const created = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			input,
		);
		expect(created).toMatchObject({
			confirmationRequired: false,
			runId: expect.any(String),
			orderId: expect.any(String),
			status: "running",
		});
		const repeated = await startPaymentTestRun(
			fixture.runtime,
			fixture.sandboxContext,
			input,
		);
		expect(repeated).toMatchObject({
			runId: created.runId,
			orderId: created.orderId,
		});
		const row = await fixture.db
			.prepare(
				`SELECT run.protocol, run.order_id, run.request_snapshot, run.response_snapshot,
					 order_record.api_protocol
					 FROM payment_test_runs run JOIN orders order_record ON order_record.id = run.order_id
					 WHERE run.id = ?`,
			)
			.bind(created.runId)
			.first<{
				protocol: string;
				order_id: string;
				request_snapshot: string;
				response_snapshot: string;
				api_protocol: string;
			}>();
		expect(row).toMatchObject({
			protocol,
			order_id: created.orderId,
			api_protocol: protocol,
		});
		const evidence = `${row?.request_snapshot}${row?.response_snapshot}`;
		expect(evidence).toContain("[REDACTED]");
		expect(evidence).not.toContain(fixture.merchant.sandboxCredential.secret);
		expect(evidence).not.toMatch(/"(?:signature|sign)":"[0-9a-f]+"/);
	});

	it("rejects raw console input that conflicts with the selected resources", async () => {
		await expect(
			startPaymentTestRun(fixture.runtime, fixture.sandboxContext, {
				protocol: "gmpay",
				paymentMode: "simulator",
				apiKeyId: fixture.preset.apiKeyId,
				receivingMethodId: fixture.preset.receivingMethodId,
				paymentAssetId: fixture.preset.paymentAssetId,
				amountMinor: "100",
				currency: "USD",
				externalOrderId: "TEST-RAW-001",
				clientIdempotencyKey: "test-raw-001",
				callback: { mode: "builtin" },
				rawInput: '{"amount":"2.00"}',
			}),
		).rejects.toMatchObject({ code: "payment_test_raw_input_mismatch" });
	});
});
