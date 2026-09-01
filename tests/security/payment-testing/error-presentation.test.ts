import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { paymentTestOperationErrorMessage } from "#/features/payment-testing/error-message";
import { m } from "#/paraglide/messages";
import { ServerFunctionError } from "#/server/server-function-errors";

describe("payment test error presentation", () => {
	it.each([
		["invalid_input", m.payment_test_error_invalid_input()],
		[
			"payment_test_method_not_ready",
			m.payment_test_error_configuration_required(),
		],
		[
			"payment_test_queue_unavailable",
			m.payment_test_error_queue_unavailable(),
		],
	] as const)("maps reviewed code %s to localized copy", (code, message) => {
		expect(
			paymentTestOperationErrorMessage(
				new ServerFunctionError(code, 409, code),
			),
		).toBe(message);
	});

	it("keeps unknown details generic", () => {
		expect(
			paymentTestOperationErrorMessage(
				new Error("D1_ERROR: SELECT secret_encrypted; token=unsafe"),
			),
		).toBe(m.payment_test_operation_failed());
	});

	it.each([
		[new Error("Invalid request"), m.payment_test_error_invalid_input()],
		[new Error("Forbidden"), m.payment_test_error_permission_denied()],
		[
			new Error("The receiving target is invalid."),
			m.payment_test_error_receiving_target_invalid(),
		],
	] as const)("maps safe server message %s when the error code is unavailable", (error, message) => {
		expect(paymentTestOperationErrorMessage(error)).toBe(message);
	});

	it("passes payment test failures to the reviewed error mapper", async () => {
		const page = await readFile(
			new URL(
				"../../../src/features/payment-testing/pages/guided-test.tsx",
				import.meta.url,
			),
			"utf8",
		);

		expect(page).toContain("paymentTestOperationErrorMessage(error)");
		expect(page).not.toContain("error.message");
	});
});
