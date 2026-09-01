import { readdir, readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("payment test center migration", () => {
	let miniflare: Miniflare;
	let db: D1Database;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-payment-test-migration" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrationRange(db, 0, 10);
		const now = Date.now();
		await db
			.prepare(
				"INSERT INTO payment_rails (code, name, kind, adapter, created_at, updated_at) VALUES ('legacy-test-rail', 'Legacy Rail', 'chain', 'tron', ?, ?)",
			)
			.bind(now, now)
			.run();
		await applyMigrationRange(db, 11, 11);
	});

	afterAll(async () => miniflare.dispose());

	it("preserves legacy rails as mainnet", async () => {
		await expect(
			db
				.prepare(
					"SELECT code, network_class FROM payment_rails WHERE code = 'legacy-test-rail'",
				)
				.first(),
		).resolves.toEqual({
			code: "legacy-test-rail",
			network_class: "mainnet",
		});
	});

	it("creates scoped run and callback evidence tables", async () => {
		const tables = await db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('payment_test_runs', 'payment_test_callback_receipts') ORDER BY name",
			)
			.all<{ name: string }>();
		expect(tables.results).toEqual([
			{ name: "payment_test_callback_receipts" },
			{ name: "payment_test_runs" },
		]);
		const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
		expect(foreignKeys.results).toEqual([]);
	});

	it("creates scope-leading history, active-run, and callback indexes", async () => {
		const indexes = await db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'payment_test_%' ORDER BY name",
			)
			.all<{ name: string }>();
		expect(indexes.results.map((row) => row.name)).toEqual(
			expect.arrayContaining([
				"payment_test_runs_scope_idempotency_uidx",
				"payment_test_runs_order_uidx",
				"payment_test_runs_history_idx",
				"payment_test_runs_active_idx",
				"payment_test_callback_receipts_delivery_attempt_uidx",
				"payment_test_callback_receipts_run_received_idx",
			]),
		);
	});
});

async function applyMigrationRange(
	database: D1Database,
	from: number,
	to: number,
) {
	const directory = new URL("../../../drizzle/", import.meta.url);
	const files = (await readdir(directory))
		.filter((name) => /^\d+_.+\.sql$/.test(name))
		.filter((name) => {
			const number = Number(name.slice(0, 4));
			return number >= from && number <= to;
		})
		.sort();
	for (const file of files) {
		const migration = await readFile(new URL(file, directory), "utf8");
		for (const statement of migration
			.split("--> statement-breakpoint")
			.map((value) => value.trim())
			.filter(Boolean))
			await database.prepare(statement).run();
	}
}
