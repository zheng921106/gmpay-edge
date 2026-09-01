import { describe, expect, it } from "vitest";
import { isPaymentTestCallbackDestinationSafe } from "#/features/payment-testing/server/preflight";

describe("payment test callback SSRF boundary", () => {
	it("allows the built-in callback on the instance origin only", async () => {
		await expect(
			isPaymentTestCallbackDestinationSafe(
				{ mode: "builtin" },
				"http://127.0.0.1:3000",
				async () => ["127.0.0.1"],
			),
		).resolves.toBe(true);
	});

	it("rejects private or rebound custom callback hosts", async () => {
		await expect(
			isPaymentTestCallbackDestinationSafe(
				{ mode: "custom", url: "https://merchant.example/callback" },
				"https://pay.example",
				async () => ["93.184.216.34", "10.0.0.1"],
			),
		).resolves.toBe(false);
		await expect(
			isPaymentTestCallbackDestinationSafe(
				{ mode: "custom", url: "https://merchant.example/callback" },
				"https://pay.example",
				async () => ["93.184.216.34"],
			),
		).resolves.toBe(true);
	});
});
