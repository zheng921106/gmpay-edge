import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("merchant API guide content", () => {
	it("keeps the Chinese and English guides paired and integration-ready", async () => {
		const [chinese, english] = await Promise.all([
			readFile(
				new URL("../../../docs/zh-CN/MERCHANT_API.md", import.meta.url),
				"utf8",
			),
			readFile(
				new URL("../../../docs/en-US/MERCHANT_API.md", import.meta.url),
				"utf8",
			),
		]);

		for (const guide of [chinese, english]) {
			expect(guide).toContain("/payments/gmpay/v1/order/create-transaction");
			expect(guide).toContain(
				"/payments/epay/v1/order/create-transaction/submit.php",
			);
			expect(guide).toContain("HMAC-SHA256");
			expect(guide).toContain("MD5");
			expect(guide).toContain("payment_url");
			expect(guide).toContain("Webhook");
			expect(guide).toContain("sandbox");
			expect(guide).toContain("production");
		}

		expect(chinese).toContain("商城接入交付清单");
		expect(english).toContain("Shop Integration Handoff");
	});
});
