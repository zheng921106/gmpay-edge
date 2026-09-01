import {
	apiKeys,
	paymentIngresses,
	receivingMethodAssets,
	receivingMethods,
} from "#/db/schema";
import type { MerchantPaymentIngress } from "#/features/merchants/server/payment-ingresses";
import { DomainError } from "#/lib/domain-error";
import {
	encryptSecret,
	generateApiPid,
	generateApiSecret,
} from "#/lib/secrets";
import type { AppDb } from "#/server/db.server";
import { loadRuntimeConfig } from "#/server/runtime-config";

const sandboxTestKeyName = "Payment Test Sandbox";
const sandboxTestMethodName = "Payment Simulator";
const sandboxTestScopes = [
	"orders:create",
	"orders:read",
	"orders:update",
	"assets:read",
] as const;

export type SandboxTestBootstrapStatements = Awaited<
	ReturnType<typeof buildSandboxTestBootstrap>
>;

export async function buildSandboxTestBootstrap(input: {
	merchantId: string;
	environmentId: string;
	apiKeyPepper: string;
	now: Date;
}) {
	if (!input.apiKeyPepper)
		throw new DomainError(
			"api_key_pepper_not_configured",
			503,
			"API key pepper is not configured",
		);
	const secret = generateApiSecret();
	const pid = generateApiPid();
	const apiKeyId = await stableUuid(
		`payment-test-key:${input.merchantId}:${input.environmentId}`,
	);
	const receivingMethodId = await stableUuid(
		`payment-test-method:${input.merchantId}:${input.environmentId}`,
	);
	const assetBindingId = await stableUuid(
		`payment-test-asset:${input.merchantId}:${input.environmentId}`,
	);
	const targetValue = `sim_${input.merchantId.replaceAll("-", "").slice(0, 32)}`;
	return {
		credential: {
			id: apiKeyId,
			merchantId: input.merchantId,
			environmentId: input.environmentId,
			name: sandboxTestKeyName,
			pid,
			secretEncrypted: await encryptSecret(secret, input.apiKeyPepper),
			scopes: [...sandboxTestScopes],
			enabled: true,
			createdAt: input.now,
			updatedAt: input.now,
		},
		simulatorIngress: {
			id: `${input.environmentId}:connection-simulator-default`,
			merchantId: input.merchantId,
			environmentId: input.environmentId,
			railCode: "simulator",
			name: "Internal Simulator",
			type: "rpc",
			transport: "http",
			endpoint: null,
			apiKey: null,
			priority: 100,
			enabled: true,
			healthStatus: "unknown",
			createdAt: input.now,
			updatedAt: input.now,
		} satisfies MerchantPaymentIngress,
		receivingMethod: {
			id: receivingMethodId,
			merchantId: input.merchantId,
			environmentId: input.environmentId,
			name: sandboxTestMethodName,
			railCode: "simulator",
			targetType: "address" as const,
			targetValue,
			normalizedTargetValue: targetValue,
			sortOrder: 0,
			enabled: true,
			createdAt: input.now,
			updatedAt: input.now,
		},
		assetBinding: {
			id: assetBindingId,
			receivingMethodId,
			paymentAssetId: "simulator-usdt",
			createdAt: input.now,
			updatedAt: input.now,
		},
		plaintextCredential: { id: apiKeyId, pid, secret },
	};
}

export function sandboxTestBootstrapDrizzleStatements(
	db: AppDb,
	bootstrap: SandboxTestBootstrapStatements,
) {
	return [
		db.insert(apiKeys).values(bootstrap.credential).onConflictDoNothing(),
		db
			.insert(paymentIngresses)
			.values(bootstrap.simulatorIngress)
			.onConflictDoNothing(),
		db
			.insert(receivingMethods)
			.values(bootstrap.receivingMethod)
			.onConflictDoNothing(),
		db
			.insert(receivingMethodAssets)
			.values(bootstrap.assetBinding)
			.onConflictDoNothing(),
	];
}

export function sandboxTestBootstrapD1Statements(
	db: D1Database,
	bootstrap: SandboxTestBootstrapStatements,
) {
	const { credential, simulatorIngress, receivingMethod, assetBinding } =
		bootstrap;
	return [
		db
			.prepare(
				`INSERT OR IGNORE INTO api_keys
				 (id, merchant_id, environment_id, name, pid, secret_encrypted, scopes, enabled, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			)
			.bind(
				credential.id,
				credential.merchantId,
				credential.environmentId,
				credential.name,
				credential.pid,
				credential.secretEncrypted,
				JSON.stringify(credential.scopes),
				credential.createdAt.getTime(),
				credential.updatedAt.getTime(),
			),
		db
			.prepare(
				`INSERT OR IGNORE INTO payment_ingresses
				 (id, merchant_id, environment_id, rail_code, name, type, transport, endpoint, api_key, priority, enabled, health_status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				simulatorIngress.id,
				simulatorIngress.merchantId,
				simulatorIngress.environmentId,
				simulatorIngress.railCode,
				simulatorIngress.name,
				simulatorIngress.type,
				simulatorIngress.transport,
				simulatorIngress.endpoint,
				simulatorIngress.apiKey,
				simulatorIngress.priority,
				simulatorIngress.enabled,
				simulatorIngress.healthStatus,
				simulatorIngress.createdAt.getTime(),
				simulatorIngress.updatedAt.getTime(),
			),
		db
			.prepare(
				`INSERT OR IGNORE INTO receiving_methods
				 (id, merchant_id, environment_id, name, rail_code, target_type, target_value, normalized_target_value, sort_order, enabled, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			)
			.bind(
				receivingMethod.id,
				receivingMethod.merchantId,
				receivingMethod.environmentId,
				receivingMethod.name,
				receivingMethod.railCode,
				receivingMethod.targetType,
				receivingMethod.targetValue,
				receivingMethod.normalizedTargetValue,
				receivingMethod.sortOrder,
				receivingMethod.createdAt.getTime(),
				receivingMethod.updatedAt.getTime(),
			),
		db
			.prepare(
				`INSERT OR IGNORE INTO receiving_method_assets
				 (id, receiving_method_id, payment_asset_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.bind(
				assetBinding.id,
				assetBinding.receivingMethodId,
				assetBinding.paymentAssetId,
				assetBinding.createdAt.getTime(),
				assetBinding.updatedAt.getTime(),
			),
	];
}

export async function ensureSandboxTestBootstrap(
	db: D1Database,
	context: {
		merchantId: string;
		environmentId: string;
		apiKeyPepper?: string;
		now?: number;
	},
) {
	const environment = await db
		.prepare(
			"SELECT code FROM merchant_environments WHERE id = ? AND merchant_id = ?",
		)
		.bind(context.environmentId, context.merchantId)
		.first<{ code: string }>();
	if (environment?.code !== "sandbox")
		throw new DomainError(
			"sandbox_environment_required",
			400,
			"Sandbox test resources require a sandbox environment.",
		);
	const pepper =
		context.apiKeyPepper ?? (await loadRuntimeConfig(db)).apiKeyPepper;
	const bootstrap = await buildSandboxTestBootstrap({
		merchantId: context.merchantId,
		environmentId: context.environmentId,
		apiKeyPepper: pepper,
		now: new Date(context.now ?? Date.now()),
	});
	await db.batch(sandboxTestBootstrapD1Statements(db, bootstrap));
	return loadSandboxTestPreset(db, context);
}

export async function loadSandboxTestPreset(
	db: D1Database,
	context: { merchantId: string; environmentId: string },
) {
	const [apiKeyId, receivingMethodId] = await Promise.all([
		stableUuid(
			`payment-test-key:${context.merchantId}:${context.environmentId}`,
		),
		stableUuid(
			`payment-test-method:${context.merchantId}:${context.environmentId}`,
		),
	]);
	const preset = await db
		.prepare(
			`SELECT ak.id AS api_key_id, ak.pid,
			 rm.id AS receiving_method_id, link.payment_asset_id
			 FROM merchant_environments environment
			 JOIN api_keys ak ON ak.merchant_id = environment.merchant_id
			  AND ak.environment_id = environment.id
			 JOIN receiving_methods rm ON rm.merchant_id = environment.merchant_id
			  AND rm.environment_id = environment.id
			 JOIN receiving_method_assets link ON link.receiving_method_id = rm.id
			 WHERE environment.id = ? AND environment.merchant_id = ?
			 AND environment.code = 'sandbox'
			 AND ak.id = ? AND ak.enabled = 1 AND ak.revoked_at IS NULL
			 AND rm.id = ? AND rm.rail_code = 'simulator' AND rm.enabled = 1
			 AND link.payment_asset_id = 'simulator-usdt'
			 LIMIT 1`,
		)
		.bind(
			context.environmentId,
			context.merchantId,
			apiKeyId,
			receivingMethodId,
		)
		.first<{
			api_key_id: string;
			pid: string;
			receiving_method_id: string;
			payment_asset_id: string;
		}>();
	if (!preset)
		throw new DomainError(
			"sandbox_test_bootstrap_missing",
			409,
			"Sandbox test resources are not ready.",
		);
	return {
		protocol: "gmpay" as const,
		paymentMode: "simulator" as const,
		apiKeyId: preset.api_key_id,
		apiKeyPid: preset.pid,
		receivingMethodId: preset.receiving_method_id,
		paymentAssetId: preset.payment_asset_id,
		amountMinor: "100",
		currency: "USD",
		callbackMode: "builtin" as const,
	};
}

async function stableUuid(value: string) {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	).slice(0, 16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
