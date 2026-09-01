import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPaymentTestFixture } from "../../helpers/payment-test-fixture";

describe("payment test runtime contract", () => {
	it("keeps the D1 schema and runtime-neutral feature boundary", async () => {
		const fixture = await createPaymentTestFixture(
			"payment-test-runtime-parity",
		);
		try {
			const tables = await fixture.db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'payment_test_%' ORDER BY name",
				)
				.all<{ name: string }>();
			expect(tables.results.map((row) => row.name)).toEqual([
				"payment_test_callback_receipts",
				"payment_test_runs",
			]);
			const sources = await Promise.all(
				[
					"bootstrap.ts",
					"callback.ts",
					"confirmation.ts",
					"preflight.ts",
					"protocol-request.ts",
					"runs.ts",
					"simulator.ts",
					"timeline.ts",
				].map((file) =>
					readFile(
						new URL(
							`../../../src/features/payment-testing/server/${file}`,
							import.meta.url,
						),
						"utf8",
					),
				),
			);
			expect(sources.join("\n")).not.toContain("import.meta.env.DEV");
		} finally {
			await fixture.miniflare.dispose();
		}
	});
});
