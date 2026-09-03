import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("merchant API documentation page", () => {
	it("renders the focused documentation workspace without the legacy embedded reference", async () => {
		const source = await readFile(
			new URL(
				"../../../src/features/docs/api-reference-client.tsx",
				import.meta.url,
			),
			"utf8",
		);

		expect(source).toContain("data-docs-workspace");
		expect(source).toContain("data-docs-sidebar");
		expect(source).toContain("data-docs-download");
		expect(source).toContain('href="/openapi.yaml"');
		expect(source).toContain('id="quick-start"');
		expect(source).toContain('id: "gmpay"');
		expect(source).toContain('id: "epay"');
		expect(source).not.toContain("Scalar.createApiReference");
		expect(source).not.toContain('id="openapi-reference"');
	});

	it("maps the published bilingual guide headings to sidebar anchors", async () => {
		const source = await readFile(
			new URL("../../../src/features/docs/merchant-guide.tsx", import.meta.url),
			"utf8",
		);

		expect(source).toContain('"GMPay 创建订单": "gmpay"');
		expect(source).toContain('"Create a GMPay order": "gmpay"');
		expect(source).toContain('"EPay 兼容接口": "epay"');
		expect(source).toContain('"EPay compatibility API": "epay"');
		expect(source).toContain('"错误、限流与故障恢复": "reliability"');
		expect(source).toContain(
			'"Errors, rate limits, and recovery": "reliability"',
		);
	});
});
