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
});
