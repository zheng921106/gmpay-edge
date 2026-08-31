import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setApiKeyEnabled } from "#/features/api-keys/server/enabled";
import {
	authenticateGmpayParameters,
	signGmpayParameters,
} from "#/features/api-keys/server/gmpay-signature";
import { listApiKeys } from "#/features/api-keys/server/list";
import { encryptSecret } from "#/lib/secrets";
import { applyMigrations } from "../../integration/migrations";

describe("merchant API-key scope", () => {
	let miniflare: Miniflare;
	let db: D1Database;
	const secret = "merchant-scope-secret";
	const pepper = "merchant-scope-pepper";

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-api-key-scope" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		const now = Date.now();
		await db.batch([
			db
				.prepare(
					"INSERT INTO system_settings (key, value, is_secret, created_at, updated_at) VALUES ('runtime.api_key_pepper', ?, 1, ?, ?)",
				)
				.bind(JSON.stringify(pepper), now, now),
			db
				.prepare(
					"INSERT INTO merchants (id, slug, name, status, created_at, updated_at) VALUES ('merchant-a', 'merchant-a', 'Merchant A', 'active', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO merchant_environments (id, merchant_id, code, status, created_at, updated_at) VALUES ('environment-a', 'merchant-a', 'sandbox', 'active', ?, ?)",
				)
				.bind(now, now),
			db
				.prepare(
					"INSERT INTO api_keys (id, merchant_id, environment_id, name, pid, secret_encrypted, scopes, created_at, updated_at) VALUES ('key-a', 'merchant-a', 'environment-a', 'Sandbox', 'merchant-a-key', ?, '[\"orders:create\"]', ?, ?)",
				)
				.bind(await encryptSecret(secret, pepper), now, now),
		]);
	});

	afterAll(async () => miniflare.dispose());

	it("derives merchant and environment from the authenticated key", async () => {
		const input = { pid: "merchant-a-key", order_id: "order-1" };
		const principal = await authenticateGmpayParameters(
			db,
			{ ...input, signature: signGmpayParameters(input, secret) },
			"orders:create",
		);
		expect(principal).toMatchObject({
			apiKeyId: "key-a",
			merchantId: "merchant-a",
			environmentId: "environment-a",
			environment: "sandbox",
		});
	});

	it("fails closed when the merchant environment is suspended", async () => {
		await db
			.prepare(
				"UPDATE merchant_environments SET status = 'suspended' WHERE id = 'environment-a'",
			)
			.run();
		const input = { pid: "merchant-a-key", order_id: "order-2" };
		await expect(
			authenticateGmpayParameters(
				db,
				{ ...input, signature: signGmpayParameters(input, secret) },
				"orders:create",
			),
		).resolves.toBeNull();
	});

	it("does not expose or mutate a key from another merchant scope", async () => {
		await db
			.prepare(
				"UPDATE merchant_environments SET status = 'active' WHERE id = 'environment-a'",
			)
			.run();
		await expect(
			listApiKeys(db, {
				merchantId: "default-merchant",
				environmentId: "default-production",
				pageIndex: 0,
				pageSize: 10,
				search: "",
			}),
		).resolves.toMatchObject({ total: 0, data: [] });
		await expect(
			setApiKeyEnabled(db, {
				id: "key-a",
				merchantId: "default-merchant",
				environmentId: "default-production",
				enabled: false,
				actorUserId: "test-user",
			}),
		).rejects.toMatchObject({ code: "api_key_not_found", status: 404 });
		expect(
			await db
				.prepare("SELECT enabled FROM api_keys WHERE id = 'key-a'")
				.first<{ enabled: number }>(),
		).toEqual({ enabled: 1 });
	});
});
