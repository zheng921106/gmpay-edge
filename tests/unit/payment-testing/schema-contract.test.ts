import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
	paymentRails,
	paymentTestCallbackReceipts,
	paymentTestRuns,
} from "#/db/schema";

describe("payment test center schema contract", () => {
	it("classifies payment rails by network class", () => {
		expect(paymentRails.networkClass).toBeDefined();
		expect(getTableConfig(paymentRails).name).toBe("payment_rails");
	});

	it("scopes test runs and keeps run creation and order association unique", () => {
		const config = getTableConfig(paymentTestRuns);
		expect(config.name).toBe("payment_test_runs");
		expect(paymentTestRuns.merchantId).toBeDefined();
		expect(paymentTestRuns.environmentId).toBeDefined();
		expect(paymentTestRuns.createdByUserId).toBeDefined();
		expect(paymentTestRuns.protocol).toBeDefined();
		expect(paymentTestRuns.paymentMode).toBeDefined();
		expect(paymentTestRuns.status).toBeDefined();
		expect(paymentTestRuns.requestSnapshot).toBeDefined();
		expect(paymentTestRuns.responseSnapshot).toBeDefined();
		expect(paymentTestRuns.confirmationNonceHash).toBeDefined();
		expect(paymentTestRuns.callbackTokenHash).toBeDefined();

		const indexes = config.indexes.map((index) => index.config.name);
		expect(indexes).toEqual(
			expect.arrayContaining([
				"payment_test_runs_scope_idempotency_uidx",
				"payment_test_runs_order_uidx",
				"payment_test_runs_history_idx",
				"payment_test_runs_active_idx",
			]),
		);
		expect(config.foreignKeys).toHaveLength(5);
	});

	it("correlates callback evidence to one delivery attempt", () => {
		const config = getTableConfig(paymentTestCallbackReceipts);
		expect(config.name).toBe("payment_test_callback_receipts");
		expect(paymentTestCallbackReceipts.runId).toBeDefined();
		expect(paymentTestCallbackReceipts.deliveryId).toBeDefined();
		expect(paymentTestCallbackReceipts.attempt).toBeDefined();
		expect(paymentTestCallbackReceipts.signatureStatus).toBeDefined();
		expect(paymentTestCallbackReceipts.requestHeaders).toBeDefined();
		expect(paymentTestCallbackReceipts.requestBody).toBeDefined();
		expect(config.indexes.map((index) => index.config.name)).toEqual(
			expect.arrayContaining([
				"payment_test_callback_receipts_delivery_attempt_uidx",
				"payment_test_callback_receipts_run_received_idx",
				"payment_test_callback_receipts_retention_idx",
			]),
		);
	});
});
