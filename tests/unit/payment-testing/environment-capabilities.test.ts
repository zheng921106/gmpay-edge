import { describe, expect, it } from "vitest";
import { assertPaymentModeAllowed } from "#/features/payment-testing/environment";

describe("payment test environment capabilities", () => {
	it.each([
		["sandbox", "simulator", "simulated"],
		["sandbox", "testnet", "testnet"],
		["production", "live", "mainnet"],
	] as const)("allows %s %s on a %s rail", (environment, mode, networkClass) => {
		expect(() =>
			assertPaymentModeAllowed(environment, mode, networkClass),
		).not.toThrow();
	});

	it.each([
		["sandbox", "live", "mainnet", "payment_mode_environment_mismatch"],
		[
			"production",
			"simulator",
			"simulated",
			"payment_mode_environment_mismatch",
		],
		["production", "testnet", "testnet", "payment_mode_environment_mismatch"],
		["sandbox", "simulator", "testnet", "payment_rail_class_mismatch"],
		["sandbox", "testnet", "simulated", "payment_rail_class_mismatch"],
		["production", "live", "testnet", "payment_rail_class_mismatch"],
	] as const)("rejects %s %s on a %s rail", (environment, mode, networkClass, code) => {
		expect(() =>
			assertPaymentModeAllowed(environment, mode, networkClass),
		).toThrow(expect.objectContaining({ code }));
	});
});
