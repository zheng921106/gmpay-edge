import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	paymentNetworkClasses,
	paymentTestCallbackModes,
	paymentTestExpectedOutcomes,
	paymentTestModes,
	paymentTestProtocols,
	paymentTestStatuses,
	type RedactedProtocolSnapshot,
} from "#/features/payment-testing/types";
import { users } from "./auth";
import { timestamps } from "./common";
import { merchantEnvironments, merchants } from "./tenant";

export const apiKeys = sqliteTable(
	"api_keys",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "cascade",
		}),
		environmentId: text("environment_id").references(
			() => merchantEnvironments.id,
			{ onDelete: "cascade" },
		),
		name: text("name").notNull(),
		pid: text("pid").notNull().unique(),
		secretEncrypted: text("secret_encrypted").notNull(),
		scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
		...timestamps,
	},
	(table) => [
		index("api_keys_merchant_environment_idx").on(
			table.merchantId,
			table.environmentId,
			table.createdAt,
			table.id,
		),
	],
);

export const paymentRails = sqliteTable(
	"payment_rails",
	{
		code: text("code").primaryKey(),
		name: text("name").notNull(),
		kind: text("kind", { enum: ["chain", "exchange", "wallet"] }).notNull(),
		networkClass: text("network_class", {
			enum: paymentNetworkClasses,
		})
			.notNull()
			.default("mainnet"),
		adapter: text("adapter").notNull(),
		metadata: text("metadata", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		...timestamps,
	},
	(table) => [
		check(
			"payment_rails_network_class_check",
			sql`${table.networkClass} IN ('mainnet', 'testnet', 'simulated')`,
		),
	],
);

export const paymentAssets = sqliteTable(
	"payment_assets",
	{
		id: text("id").primaryKey(),
		railCode: text("rail_code")
			.notNull()
			.references(() => paymentRails.code),
		code: text("code").notNull(),
		symbol: text("symbol").notNull(),
		kind: text("kind", { enum: ["native", "token", "external"] }).notNull(),
		contractAddress: text("contract_address"),
		decimals: integer("decimals").notNull(),
		defaultConfirmations: integer("default_confirmations").notNull().default(1),
		...timestamps,
	},
	(table) => [
		uniqueIndex("payment_assets_rail_code_uidx").on(table.railCode, table.code),
	],
);

export const paymentIngresses = sqliteTable(
	"payment_ingresses",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "cascade",
		}),
		environmentId: text("environment_id").references(
			() => merchantEnvironments.id,
			{ onDelete: "cascade" },
		),
		railCode: text("rail_code").references(() => paymentRails.code),
		name: text("name").notNull(),
		type: text("type", {
			enum: ["rpc", "provider", "provider_webhook"],
		}).notNull(),
		transport: text("transport", {
			enum: ["http", "websocket", "webhook"],
		})
			.notNull()
			.default("http"),
		endpoint: text("endpoint"),
		apiKey: text("api_key"),
		provider: text("provider", { enum: ["alchemy"] }),
		network: text("network"),
		externalNetwork: text("external_network"),
		externalSourceId: text("external_source_id"),
		configEncrypted: text("config_encrypted"),
		mode: text("mode", { enum: ["shadow", "active"] }),
		desiredAddressesHash: text("desired_addresses_hash"),
		reconcileRequiredAt: integer("reconcile_required_at", {
			mode: "timestamp_ms",
		}),
		lastReconciledAt: integer("last_reconciled_at", {
			mode: "timestamp_ms",
		}),
		lastEventAt: integer("last_event_at", { mode: "timestamp_ms" }),
		priority: integer("priority").notNull().default(100),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
		healthStatus: text("health_status", {
			enum: ["unknown", "healthy", "degraded", "unhealthy"],
		})
			.notNull()
			.default("unknown"),
		lastLatencyMs: integer("last_latency_ms"),
		lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
		lastErrorCode: text("last_error_code"),
		timeoutMs: integer("timeout_ms"),
		blockLookback: integer("block_lookback"),
		logBlockRange: integer("log_block_range"),
		maxScanTransactions: integer("max_scan_transactions"),
		...timestamps,
	},
	(table) => [
		check(
			"payment_ingresses_shape_check",
			sql`(${table.type} = 'provider_webhook'
				AND ${table.railCode} IS NULL
				AND ${table.provider} IS NOT NULL
				AND ${table.network} IS NOT NULL
				AND ${table.externalNetwork} IS NOT NULL
				AND ${table.externalSourceId} IS NOT NULL
				AND ${table.configEncrypted} IS NOT NULL
				AND ${table.mode} IS NOT NULL
				AND ${table.transport} = 'webhook')
			OR (${table.type} != 'provider_webhook'
				AND ${table.railCode} IS NOT NULL
				AND ${table.provider} IS NULL
				AND ${table.network} IS NULL
				AND ${table.externalNetwork} IS NULL
				AND ${table.externalSourceId} IS NULL
				AND ${table.configEncrypted} IS NULL
				AND ${table.mode} IS NULL
				AND ${table.transport} != 'webhook')`,
		),
		check(
			"payment_ingresses_provider_enabled_check",
			sql`type != 'provider' OR enabled = 1`,
		),
		index("payment_ingresses_rail_priority_idx").on(
			table.railCode,
			table.enabled,
			table.priority,
		),
		index("payment_ingresses_health_due_idx")
			.on(
				sql`${table.lastCheckedAt} IS NOT NULL`,
				table.lastCheckedAt,
				table.priority,
				table.id,
			)
			.where(sql`${table.enabled} = 1`),
		uniqueIndex("payment_ingresses_provider_network_uidx")
			.on(table.merchantId, table.environmentId, table.provider, table.network)
			.where(sql`${table.type} = 'provider_webhook'`),
		uniqueIndex("payment_ingresses_external_uidx")
			.on(
				table.merchantId,
				table.environmentId,
				table.provider,
				table.externalSourceId,
			)
			.where(sql`${table.type} = 'provider_webhook'`),
		index("payment_ingresses_reconcile_idx").on(
			table.reconcileRequiredAt,
			table.id,
		),
	],
);

export const paymentIngressCredentials = sqliteTable(
	"payment_ingress_credentials",
	{
		paymentIngressId: text("payment_ingress_id")
			.primaryKey()
			.references(() => paymentIngresses.id, { onDelete: "cascade" }),
		configEncrypted: text("config_encrypted").notNull(),
		...timestamps,
	},
);

export const receivingMethods = sqliteTable(
	"receiving_methods",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "cascade",
		}),
		environmentId: text("environment_id").references(
			() => merchantEnvironments.id,
			{ onDelete: "cascade" },
		),
		name: text("name").notNull(),
		railCode: text("rail_code")
			.notNull()
			.references(() => paymentRails.code),
		targetType: text("target_type", {
			enum: ["address", "account", "provider"],
		}).notNull(),
		targetValue: text("target_value").notNull(),
		normalizedTargetValue: text("normalized_target_value").notNull(),
		targetMetadata: text("target_metadata", { mode: "json" }).$type<
			Record<string, string>
		>(),
		configEncrypted: text("config_encrypted"),
		minAmountMinor: text("min_amount_minor"),
		maxAmountMinor: text("max_amount_minor"),
		sortOrder: integer("sort_order").notNull().default(100),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
		...timestamps,
	},
	(table) => [
		uniqueIndex("receiving_methods_merchant_environment_target_uidx").on(
			table.merchantId,
			table.environmentId,
			table.railCode,
			table.normalizedTargetValue,
		),
		index("receiving_methods_enabled_sort_idx").on(
			table.enabled,
			table.sortOrder,
		),
		index("receiving_methods_rail_idx").on(table.railCode),
	],
);

export const receivingMethodAssets = sqliteTable(
	"receiving_method_assets",
	{
		id: text("id").primaryKey(),
		receivingMethodId: text("receiving_method_id")
			.notNull()
			.references(() => receivingMethods.id, { onDelete: "cascade" }),
		paymentAssetId: text("payment_asset_id")
			.notNull()
			.references(() => paymentAssets.id),
		...timestamps,
	},
	(table) => [
		uniqueIndex("receiving_method_assets_pair_uidx").on(
			table.receivingMethodId,
			table.paymentAssetId,
		),
		index("receiving_method_assets_asset_idx").on(table.paymentAssetId),
	],
);

export const orders = sqliteTable(
	"orders",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "cascade",
		}),
		environmentId: text("environment_id").references(
			() => merchantEnvironments.id,
			{ onDelete: "cascade" },
		),
		externalOrderId: text("external_order_id").notNull(),
		apiKeyId: text("api_key_id").references(() => apiKeys.id),
		apiProtocol: text("api_protocol", { enum: ["gmpay", "epay"] }),
		status: text("status", {
			enum: [
				"pending",
				"confirming",
				"paid",
				"partially_paid",
				"overpaid",
				"expired",
				"cancelled",
				"failed",
				"refunded",
			],
		})
			.notNull()
			.default("pending"),
		amountMinor: text("amount_minor").notNull(),
		currency: text("currency").notNull(),
		currencyDecimals: integer("currency_decimals").notNull(),
		paymentAssetId: text("payment_asset_id").references(() => paymentAssets.id),
		providerOrderId: text("provider_order_id"),
		paymentUrl: text("payment_url"),
		receivedAmountUnits: text("received_amount_units").notNull().default("0"),
		description: text("description"),
		returnUrl: text("return_url"),
		notifyUrl: text("notify_url"),
		metadata: text("metadata", { mode: "json" }).$type<
			Record<string, string>
		>(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		paidAt: integer("paid_at", { mode: "timestamp_ms" }),
		lastPaymentScanAt: integer("last_payment_scan_at", {
			mode: "timestamp_ms",
		}),
		paymentScanCursor: text("payment_scan_cursor"),
		version: integer("version").notNull().default(0),
		...timestamps,
	},
	(table) => [
		uniqueIndex("orders_merchant_environment_api_key_external_id_uidx")
			.on(
				table.merchantId,
				table.environmentId,
				table.apiKeyId,
				table.externalOrderId,
			)
			.where(sql`${table.apiKeyId} IS NOT NULL`),
		uniqueIndex("orders_merchant_environment_external_id_uidx")
			.on(table.merchantId, table.environmentId, table.externalOrderId)
			.where(sql`${table.apiKeyId} IS NULL`),
		index("orders_merchant_environment_created_at_idx").on(
			table.merchantId,
			table.environmentId,
			table.createdAt,
			table.id,
		),
		index("orders_status_idx").on(table.status),
		index("orders_expiration_idx")
			.on(table.expiresAt, table.id)
			.where(
				sql`${table.status} IN ('pending', 'confirming', 'partially_paid')`,
			),
		index("orders_payment_scan_idx")
			.on(table.lastPaymentScanAt, table.createdAt, table.id)
			.where(
				sql`${table.status} IN ('pending', 'confirming', 'partially_paid', 'paid', 'overpaid', 'expired')`,
			),
		uniqueIndex("orders_provider_order_uidx").on(table.providerOrderId),
	],
);

export const receivingMethodLocks = sqliteTable(
	"receiving_method_locks",
	{
		id: text("id").primaryKey(),
		receivingMethodId: text("receiving_method_id")
			.notNull()
			.references(() => receivingMethods.id),
		assetId: text("asset_id")
			.notNull()
			.references(() => paymentAssets.id),
		orderId: text("order_id")
			.notNull()
			.references(() => orders.id, { onDelete: "cascade" }),
		expectedAmountUnits: text("expected_amount_units").notNull(),
		collisionKey: text("collision_key").unique(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		reusableAt: integer("reusable_at", { mode: "timestamp_ms" }).notNull(),
		releasedAt: integer("released_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		index("receiving_method_locks_collision_idx").on(table.reusableAt),
		index("receiving_method_locks_expiry_idx").on(
			table.releasedAt,
			table.expiresAt,
		),
	],
);

export const orderPaymentSnapshots = sqliteTable(
	"order_payment_snapshots",
	{
		orderId: text("order_id")
			.primaryKey()
			.references(() => orders.id, { onDelete: "cascade" }),
		receivingMethodId: text("receiving_method_id")
			.notNull()
			.references(() => receivingMethods.id),
		receivingMethodName: text("receiving_method_name").notNull(),
		railCode: text("rail_code").notNull(),
		railKind: text("rail_kind", {
			enum: ["chain", "exchange", "wallet"],
		}).notNull(),
		assetId: text("asset_id").notNull(),
		assetCode: text("asset_code").notNull(),
		decimals: integer("decimals").notNull(),
		contractAddress: text("contract_address"),
		targetValue: text("target_value").notNull(),
		connectionId: text("connection_id"),
		adapter: text("adapter").notNull(),
		requiredConfirmations: integer("required_confirmations").notNull(),
		expectedAmountUnits: text("expected_amount_units").notNull(),
		rateSource: text("rate_source"),
		rawRate: text("raw_rate"),
		rateAdjustment: text("rate_adjustment"),
		finalRate: text("final_rate"),
		rateObservedAt: integer("rate_observed_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [
		index("order_payment_snapshots_receiving_method_idx").on(
			table.receivingMethodId,
		),
		index("order_payment_snapshots_connection_idx").on(table.connectionId),
		index("order_payment_snapshots_target_idx").on(
			table.railCode,
			table.targetValue,
			table.assetCode,
		),
		index("order_payment_snapshots_target_nocase_idx").on(
			table.railCode,
			sql`LOWER(${table.targetValue})`,
			table.assetCode,
		),
	],
);

export const orderPayments = sqliteTable(
	"order_payments",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => orders.id),
		transactionId: text("transaction_id").notNull(),
		amountUnits: text("amount_units").notNull(),
		confirmations: integer("confirmations").notNull().default(0),
		status: text("status", {
			enum: ["detected", "confirming", "confirmed", "reorged", "rejected"],
		}).notNull(),
		detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull(),
		confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
		...timestamps,
	},
	(table) => [
		uniqueIndex("order_payments_transaction_uidx").on(table.transactionId),
		index("order_payments_order_idx").on(table.orderId),
		index("order_payments_detected_at_idx").on(table.detectedAt, table.id),
	],
);

export const paymentReviews = sqliteTable(
	"payment_reviews",
	{
		id: text("id").primaryKey(),
		orderId: text("order_id")
			.notNull()
			.references(() => orders.id, { onDelete: "cascade" }),
		status: text("status", {
			enum: ["pending", "approved", "rejected"],
		})
			.notNull()
			.default("pending"),
		transactionHash: text("transaction_hash"),
		description: text("description").notNull(),
		evidenceKey: text("evidence_key").notNull().unique(),
		evidenceContentType: text("evidence_content_type").notNull(),
		evidenceSizeBytes: integer("evidence_size_bytes").notNull(),
		evidenceSha256: text("evidence_sha256").notNull(),
		reviewerUserId: text("reviewer_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		resolutionNote: text("resolution_note"),
		reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
		...timestamps,
	},
	(table) => [
		index("payment_reviews_order_idx").on(table.orderId, table.createdAt),
		index("payment_reviews_status_idx").on(table.status, table.createdAt),
		index("payment_reviews_list_idx").on(
			sql`CASE ${table.status} WHEN 'pending' THEN 0 ELSE 1 END`,
			sql`${table.createdAt} DESC`,
			sql`${table.id} DESC`,
		),
		uniqueIndex("payment_reviews_pending_order_uidx")
			.on(table.orderId)
			.where(sql`${table.status} = 'pending'`),
	],
);

export const exchangeRates = sqliteTable(
	"exchange_rates",
	{
		id: text("id").primaryKey(),
		category: text("category", { enum: ["crypto", "fiat"] }).notNull(),
		base: text("base").notNull(),
		quote: text("quote").notNull(),
		rawRate: text("raw_rate"),
		rate: text("rate"),
		source: text("source").notNull(),
		adjustmentBps: integer("adjustment_bps").notNull().default(0),
		observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("exchange_rates_category_pair_uidx").on(
			table.category,
			table.base,
			table.quote,
		),
		index("exchange_rates_pair_idx").on(
			table.base,
			table.quote,
			table.observedAt,
		),
	],
);

export const blockchainTransactions = sqliteTable(
	"blockchain_transactions",
	{
		id: text("id").primaryKey(),
		network: text("network").notNull(),
		txHash: text("tx_hash").notNull(),
		eventIndex: integer("event_index").notNull().default(0),
		fromAddress: text("from_address").notNull(),
		toAddress: text("to_address").notNull(),
		assetCode: text("asset_code").notNull(),
		amountUnits: text("amount_units").notNull(),
		blockNumber: text("block_number").notNull(),
		blockHash: text("block_hash").notNull(),
		confirmations: integer("confirmations").notNull(),
		status: text("status", {
			enum: ["pending", "missing", "confirmed", "reorged", "failed"],
		}).notNull(),
		observedAt: integer("observed_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("blockchain_transactions_event_uidx").on(
			table.network,
			table.txHash,
			table.eventIndex,
		),
	],
);

export const idempotencyKeys = sqliteTable(
	"idempotency_keys",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id").references(() => merchants.id, {
			onDelete: "cascade",
		}),
		environmentId: text("environment_id").references(
			() => merchantEnvironments.id,
			{ onDelete: "cascade" },
		),
		key: text("key").notNull(),
		requestHash: text("request_hash").notNull(),
		responseStatus: integer("response_status"),
		responseBody: text("response_body"),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("idempotency_merchant_environment_key_uidx").on(
			table.merchantId,
			table.environmentId,
			table.key,
		),
		index("idempotency_keys_expires_idx").on(
			table.merchantId,
			table.environmentId,
			table.expiresAt,
		),
	],
);

export const rateLimitCounters = sqliteTable(
	"rate_limit_counters",
	{
		id: text("id").primaryKey(),
		bucketKey: text("bucket_key").notNull(),
		windowStart: integer("window_start").notNull(),
		count: integer("count").notNull().default(1),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex("rate_limit_counters_bucket_window_uidx").on(
			table.bucketKey,
			table.windowStart,
		),
		index("rate_limit_counters_expires_idx").on(table.expiresAt),
	],
);

export const paymentTestRuns = sqliteTable(
	"payment_test_runs",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id")
			.notNull()
			.references(() => merchants.id, { onDelete: "cascade" }),
		environmentId: text("environment_id")
			.notNull()
			.references(() => merchantEnvironments.id, { onDelete: "cascade" }),
		createdByUserId: text("created_by_user_id")
			.notNull()
			.references(() => users.id),
		protocol: text("protocol", { enum: paymentTestProtocols }).notNull(),
		paymentMode: text("payment_mode", {
			enum: paymentTestModes,
		}).notNull(),
		apiKeyId: text("api_key_id")
			.notNull()
			.references(() => apiKeys.id),
		externalOrderId: text("external_order_id").notNull(),
		orderId: text("order_id").references(() => orders.id),
		callbackMode: text("callback_mode", {
			enum: paymentTestCallbackModes,
		}).notNull(),
		callbackDestinationSnapshot: text("callback_destination_snapshot", {
			mode: "json",
		})
			.$type<{ kind: "builtin" | "custom"; display: string }>()
			.notNull(),
		status: text("status", {
			enum: paymentTestStatuses,
		})
			.notNull()
			.default("ready"),
		expectedOutcome: text("expected_outcome", {
			enum: paymentTestExpectedOutcomes,
		})
			.notNull()
			.default("paid"),
		idempotencyKey: text("idempotency_key").notNull(),
		scenario: text("scenario"),
		scenarioStep: integer("scenario_step").notNull().default(0),
		requestSnapshot: text("request_snapshot", {
			mode: "json",
		}).$type<RedactedProtocolSnapshot>(),
		responseSnapshot: text("response_snapshot", {
			mode: "json",
		}).$type<RedactedProtocolSnapshot>(),
		confirmationNonceHash: text("confirmation_nonce_hash"),
		confirmationExpiresAt: integer("confirmation_expires_at", {
			mode: "timestamp_ms",
		}),
		confirmationConsumedAt: integer("confirmation_consumed_at", {
			mode: "timestamp_ms",
		}),
		callbackTokenHash: text("callback_token_hash"),
		callbackTokenExpiresAt: integer("callback_token_expires_at", {
			mode: "timestamp_ms",
		}),
		failureCode: text("failure_code"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		...timestamps,
	},
	(table) => [
		check(
			"payment_test_runs_protocol_check",
			sql`${table.protocol} IN ('gmpay', 'epay')`,
		),
		check(
			"payment_test_runs_mode_check",
			sql`${table.paymentMode} IN ('simulator', 'testnet', 'live')`,
		),
		check(
			"payment_test_runs_status_check",
			sql`${table.status} IN ('ready', 'running', 'passed', 'failed', 'cancelled', 'expired')`,
		),
		check(
			"payment_test_runs_snapshot_size_check",
			sql`(${table.requestSnapshot} IS NULL OR length(${table.requestSnapshot}) <= 65536)
				AND (${table.responseSnapshot} IS NULL OR length(${table.responseSnapshot}) <= 65536)`,
		),
		uniqueIndex("payment_test_runs_scope_idempotency_uidx").on(
			table.merchantId,
			table.environmentId,
			table.protocol,
			table.apiKeyId,
			table.idempotencyKey,
		),
		uniqueIndex("payment_test_runs_order_uidx")
			.on(table.orderId)
			.where(sql`${table.orderId} IS NOT NULL`),
		index("payment_test_runs_history_idx").on(
			table.merchantId,
			table.environmentId,
			table.createdAt,
			table.id,
		),
		index("payment_test_runs_active_idx")
			.on(table.merchantId, table.environmentId, table.createdAt, table.id)
			.where(sql`${table.status} IN ('ready', 'running')`),
		index("payment_test_runs_retention_idx")
			.on(table.completedAt, table.id)
			.where(
				sql`${table.status} IN ('passed', 'failed', 'cancelled', 'expired')`,
			),
	],
);
