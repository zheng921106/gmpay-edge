import { describe, expect, it, vi } from "vitest";
import {
	paymentTestOperationIds,
	recordPaymentTestOperation,
	redactPaymentTestSnapshot,
} from "#/features/payment-testing/server/observability";

describe("payment test evidence redaction", () => {
	it("keeps the complete bounded operation dimension registry", () => {
		expect(paymentTestOperationIds).toEqual([
			"preflight",
			"protocol_request",
			"order_create",
			"payment_detect",
			"confirmation",
			"callback_delivery",
		]);
	});

	it("recursively removes credentials and bounds persisted snapshots", () => {
		const snapshot = redactPaymentTestSnapshot({
			apiToken: "token-value",
			nested: {
				authorization: "Bearer secret",
				password: "password-value",
				payload: "x".repeat(80_000),
			},
		});
		const serialized = JSON.stringify(snapshot);
		expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
			64 * 1024,
		);
		expect(serialized).not.toMatch(/token-value|Bearer secret|password-value/);
		expect(serialized).toContain("[REDACTED]");
	});

	it("logs only privacy-safe payment test dimensions", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		recordPaymentTestOperation({
			operation: "protocol_request",
			protocol: "gmpay",
			environment: "sandbox",
			mode: "simulator",
			scenario: "exact_success",
			result: "success",
			errorCode: null,
			durationMs: 12.3,
		});
		const event = info.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(event).toMatchObject({
			event: "payment_test_operation",
			operation: "protocol_request",
			result: "success",
		});
		expect(Object.keys(event)).not.toEqual(
			expect.arrayContaining([
				"merchantId",
				"url",
				"pid",
				"address",
				"orderId",
				"token",
			]),
		);
		info.mockRestore();
	});
});
