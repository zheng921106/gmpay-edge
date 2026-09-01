import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import * as schema from "#/db/schema";
import { registerMerchant } from "#/features/auth/server/registration";
import { installSystem } from "#/features/installation/server/install";
import { loadSandboxTestPreset } from "#/features/payment-testing/server/bootstrap";
import { encryptSecret } from "#/lib/secrets";
import { createInitialRuntimeConfig } from "#/server/runtime-config";
import { applyMigrations } from "../integration/migrations";

export async function createPaymentTestFixture(databaseName: string) {
	const miniflare = new Miniflare({
		modules: true,
		script: "export default { fetch() { return new Response('ok') } }",
		d1Databases: { DB: databaseName },
	});
	const db = await miniflare.getD1Database("DB");
	await applyMigrations(db);
	const runtime = createInitialRuntimeConfig("https://pay.example");
	await installSystem(
		drizzle(db, { schema }),
		{
			name: "Root",
			email: `${databaseName}@example.com`,
			password: "payment-test-root-password",
		},
		runtime,
	);
	const merchant = await registerMerchant(drizzle(db, { schema }), {
		name: "Payment Test Merchant",
		slug: databaseName,
		email: `${databaseName}-owner@example.com`,
		password: "payment-test-owner-password",
	});
	const preset = await loadSandboxTestPreset(db, {
		merchantId: merchant.merchantId,
		environmentId: merchant.environmentIds.sandbox,
	});
	return {
		miniflare,
		db,
		runtime: {
			DB: db,
			WEBHOOK_QUEUE: { send: async () => undefined },
			PAYMENT_QUEUE: { send: async () => undefined },
		},
		merchant,
		preset,
		sandboxContext: {
			userId: merchant.userId,
			merchantId: merchant.merchantId,
			environmentId: merchant.environmentIds.sandbox,
			environment: "sandbox" as const,
			requestOrigin: "https://pay.example",
		},
		productionContext: {
			userId: merchant.userId,
			merchantId: merchant.merchantId,
			environmentId: merchant.environmentIds.production,
			environment: "production" as const,
			requestOrigin: "https://pay.example",
		},
		apiKeyPepper: runtime.apiKeyPepper,
	};
}

export async function provisionProductionTron(input: {
	db: D1Database;
	merchantId: string;
	environmentId: string;
	apiKeyPepper: string;
}) {
	const apiKeyId = crypto.randomUUID();
	const receivingMethodId = crypto.randomUUID();
	const assetBindingId = crypto.randomUUID();
	const secret = "production-payment-test-secret";
	const now = Date.now();
	await input.db.batch([
		input.db
			.prepare(
				'INSERT INTO api_keys (id, merchant_id, environment_id, name, pid, secret_encrypted, scopes, enabled, created_at, updated_at) VALUES (?, ?, ?, \'Production Test\', \'100000000099\', ?, \'["orders:create","orders:read","orders:update","assets:read"]\', 1, ?, ?)',
			)
			.bind(
				apiKeyId,
				input.merchantId,
				input.environmentId,
				await encryptSecret(secret, input.apiKeyPepper),
				now,
				now,
			),
		input.db
			.prepare(
				"UPDATE payment_ingresses SET health_status = 'healthy', last_checked_at = ? WHERE merchant_id = ? AND environment_id = ? AND rail_code = 'tron' AND transport = 'http'",
			)
			.bind(now, input.merchantId, input.environmentId),
		input.db
			.prepare(
				"INSERT INTO receiving_methods (id, merchant_id, environment_id, name, rail_code, target_type, target_value, normalized_target_value, enabled, created_at, updated_at) VALUES (?, ?, ?, 'Production TRON', 'tron', 'address', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', 1, ?, ?)",
			)
			.bind(receivingMethodId, input.merchantId, input.environmentId, now, now),
		input.db
			.prepare(
				"INSERT OR IGNORE INTO receiving_method_assets (id, receiving_method_id, payment_asset_id, created_at, updated_at) VALUES (?, ?, 'tron-usdt', ?, ?)",
			)
			.bind(assetBindingId, receivingMethodId, now, now),
	]);
	return { apiKeyId, receivingMethodId, paymentAssetId: "tron-usdt" };
}
