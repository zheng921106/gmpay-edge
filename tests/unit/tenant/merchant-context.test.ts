import { describe, expect, it } from "vitest";
import {
	merchantContextCookieName,
	parseMerchantContextCookie,
	serializeMerchantContextCookie,
	signMerchantContext,
} from "#/server/merchant-context";

const context = {
	merchantId: "merchant-a",
	environmentId: "environment-production",
	environment: "production",
} as const;

describe("merchant context cookie", () => {
	it("signs only the scope identifiers and validates the signature", async () => {
		const value = await signMerchantContext(context, "context-secret", 1_000);
		const parsed = await parseMerchantContextCookie(
			value,
			"context-secret",
			1_001,
		);
		expect(parsed).toMatchObject(context);
		expect(value).not.toContain("context-secret");
		expect(value).not.toContain("user");
	});

	it("rejects tampering, wrong secrets, and expired contexts", async () => {
		const value = await signMerchantContext(context, "context-secret", 1_000);
		const [payload, signature] = value.split(".");
		const tampered = `${payload.slice(0, -1)}x.${signature}`;
		expect(
			await parseMerchantContextCookie(tampered, "context-secret", 1_001),
		).toBeNull();
		expect(
			await parseMerchantContextCookie(value, "wrong-secret", 1_001),
		).toBeNull();
		expect(
			await parseMerchantContextCookie(
				value,
				"context-secret",
				1_000 + 8 * 60 * 60 * 1000 + 1,
			),
		).toBeNull();
	});

	it("serializes a secure HttpOnly cookie and clears it without exposing scope", async () => {
		const value = await serializeMerchantContextCookie(
			context,
			"context-secret",
			1_000,
		);
		expect(value).toContain(`${merchantContextCookieName}=`);
		expect(value).toContain("HttpOnly");
		expect(value).toContain("Secure");
		expect(value).toContain("SameSite=Lax");
		expect(value).not.toContain("merchant-a");
	});
});
