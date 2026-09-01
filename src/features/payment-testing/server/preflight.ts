import { z } from "zod";
import { checkReceivingMethodReadiness } from "#/features/payment-settings/server/check-method-readiness";
import { assertPaymentModeAllowed } from "#/features/payment-testing/environment";
import {
	type PaymentTestStartInput,
	parsePaymentTestStartInput,
} from "#/features/payment-testing/schema";
import type {
	MerchantAccessContext,
	PaymentNetworkClass,
	PaymentTestPreflight,
} from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";
import {
	assertSafeResolvedWebhookUrl,
	resolveWebhookHostname,
} from "#/lib/webhook-url";

type PreflightRow = {
	environment_code: "sandbox" | "production";
	environment_status: string;
	merchant_status: string;
	api_key_id: string;
	pid: string;
	secret_encrypted: string;
	scopes: string;
	key_enabled: number;
	revoked_at: number | null;
	expires_at: number | null;
	receiving_method_id: string;
	target_value: string;
	asset_id: string;
	asset_code: string;
	asset_decimals: number;
	rail_code: string;
	network_class: PaymentNetworkClass;
};

const scopesSchema = z.array(z.string());

export async function preflightPaymentTest(
	db: D1Database,
	context: MerchantAccessContext,
	value: PaymentTestStartInput,
): Promise<PaymentTestPreflight> {
	const input = parsePaymentTestStartInput(value);
	const row = await db
		.prepare(
			`SELECT environment.code AS environment_code,
			 environment.status AS environment_status, merchant.status AS merchant_status,
			 key_record.id AS api_key_id, key_record.pid, key_record.secret_encrypted,
			 key_record.scopes, key_record.enabled AS key_enabled,
			 key_record.revoked_at, key_record.expires_at,
			 method.id AS receiving_method_id, method.target_value,
			 asset.id AS asset_id, asset.code AS asset_code, asset.decimals AS asset_decimals,
			 rail.code AS rail_code, rail.network_class
			 FROM merchant_environments environment
			 JOIN merchants merchant ON merchant.id = environment.merchant_id
			 JOIN api_keys key_record ON key_record.id = ?
			  AND key_record.merchant_id = merchant.id
			  AND key_record.environment_id = environment.id
			 JOIN receiving_methods method ON method.id = ?
			  AND method.merchant_id = merchant.id
			  AND method.environment_id = environment.id
			 JOIN receiving_method_assets method_asset ON method_asset.receiving_method_id = method.id
			  AND method_asset.payment_asset_id = ?
			 JOIN payment_assets asset ON asset.id = method_asset.payment_asset_id
			 JOIN payment_rails rail ON rail.code = asset.rail_code
			  AND rail.code = method.rail_code
			 WHERE merchant.id = ? AND environment.id = ? LIMIT 1`,
		)
		.bind(
			input.apiKeyId,
			input.receivingMethodId,
			input.paymentAssetId,
			context.merchantId,
			context.environmentId,
		)
		.first<PreflightRow>();
	if (!row)
		throw new DomainError(
			"payment_test_resource_not_found",
			404,
			"Payment test resources were not found.",
		);
	if (
		row.environment_code !== context.environment ||
		row.environment_status !== "active" ||
		row.merchant_status !== "active"
	)
		throw new DomainError(
			"payment_test_scope_unavailable",
			403,
			"Payment test scope is unavailable.",
		);
	const now = Date.now();
	if (
		row.key_enabled !== 1 ||
		row.revoked_at !== null ||
		(row.expires_at !== null && row.expires_at <= now)
	)
		throw new DomainError(
			"payment_test_credential_unavailable",
			409,
			"Payment test credential is unavailable.",
		);
	let scopes: string[];
	try {
		scopes = scopesSchema.parse(JSON.parse(row.scopes));
	} catch {
		throw new DomainError(
			"payment_test_credential_unavailable",
			409,
			"Payment test credential is unavailable.",
		);
	}
	if (!scopes.includes("orders:create"))
		throw new DomainError(
			"payment_test_scope_missing",
			403,
			"The selected credential cannot create orders.",
		);
	assertPaymentModeAllowed(
		row.environment_code,
		input.paymentMode,
		row.network_class,
	);
	const readiness = await checkReceivingMethodReadiness(
		db,
		row.receiving_method_id,
		{
			merchantId: context.merchantId,
			environmentId: context.environmentId,
			environmentCode: row.environment_code,
			paymentMode: input.paymentMode,
		},
	);
	if (!readiness.ready)
		throw new DomainError(
			"payment_test_method_not_ready",
			409,
			readiness.reasons[0]?.message ?? "Receiving method is not ready.",
		);
	if (
		input.callback.mode === "custom" &&
		!(await assertSafeResolvedWebhookUrl(
			input.callback.url,
			resolveWebhookHostname,
		))
	)
		throw new DomainError(
			"payment_test_callback_unsafe",
			400,
			"The callback URL is not a safe public HTTPS endpoint.",
		);
	return {
		ready: true,
		environment: row.environment_code,
		apiKey: {
			id: row.api_key_id,
			pid: row.pid,
			secretEncrypted: row.secret_encrypted,
		},
		receivingMethod: {
			id: row.receiving_method_id,
			targetValue: row.target_value,
		},
		asset: {
			id: row.asset_id,
			code: row.asset_code,
			decimals: row.asset_decimals,
		},
		rail: { code: row.rail_code, networkClass: row.network_class },
	};
}
