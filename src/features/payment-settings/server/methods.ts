import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import type { MerchantEnvironmentContext } from "#/db/schema";
import { AccessDeniedError } from "#/features/access/server/access-cache";
import { requireMerchantAccess } from "#/features/access/server/merchant-access";
import { systemPermission } from "#/features/access/system-rbac";
import { paymentSettingsError } from "#/features/payment-settings/errors";
import {
	parseReceivingUsdLimits,
	receivingLimitDecimals,
} from "#/features/payment-settings/receiving-method-limits";
import { adminContext } from "#/features/payment-settings/server/admin-context";
import { deleteReceivingMethod } from "#/features/payment-settings/server/delete-receiving-method";
import { parseReceivingProviderConfiguration } from "#/features/payment-settings/server/provider-config";
import { unitsToDecimal } from "#/lib/money";
import { encryptSecret } from "#/lib/secrets";
import { getCloudflareEnv } from "#/server/db.server";
import {
	findDefaultMerchantContext,
	loadMerchantContext,
	loadMerchantSession,
	setMerchantContext,
} from "#/server/merchant-context";
import { loadRequestRuntimeConfig } from "#/server/runtime-config";

const receivingMethodIdInput = z.object({
	id: z.string().trim().min(1).max(100),
});

export const listReceivingMethodsFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const context = await receivingMethodContext("read");
		return listReceivingMethods(context.db, context.scope);
	},
);

export async function listReceivingMethods(
	db: D1Database,
	scope: MerchantEnvironmentContext,
) {
	const rows = await db
		.prepare(
			`SELECT rm.id, rm.name, rm.enabled,
			 pa.id AS payment_method_id,
			 pa.code || ' · ' || pr.name AS payment_method_name,
			 pa.default_confirmations AS required_confirmations,
			 rm.min_amount_minor, rm.max_amount_minor, pa.decimals,
			 rm.sort_order, pa.code AS asset_code,
			 rm.rail_code, rm.target_type, rm.target_value,
			 pr.kind AS rail_kind,
			 pr.name AS rail_name
			 FROM receiving_methods rm
			 JOIN receiving_method_assets link ON link.receiving_method_id = rm.id
			 JOIN payment_assets pa ON pa.id = link.payment_asset_id
			 JOIN payment_rails pr ON pr.code = rm.rail_code
			 WHERE rm.merchant_id IS ? AND rm.environment_id IS ?
			 ORDER BY rm.sort_order, rm.name, pa.code`,
		)
		.bind(scope.merchantId, scope.environmentId)
		.all<{
			id: string;
			name: string;
			enabled: number;
			payment_method_id: string;
			payment_method_name: string;
			required_confirmations: number;
			min_amount_minor: string | null;
			max_amount_minor: string | null;
			decimals: number;
			sort_order: number;
			asset_code: string;
			rail_code: string;
			target_type: "address" | "account" | "provider";
			target_value: string;
			rail_kind: "chain" | "exchange" | "wallet";
			rail_name: string;
		}>();
	const grouped = new Map<
		string,
		Omit<
			(typeof rows.results)[number],
			| "payment_method_id"
			| "payment_method_name"
			| "required_confirmations"
			| "min_amount_minor"
			| "max_amount_minor"
			| "decimals"
			| "asset_code"
		> & {
			min_amount: string | null;
			max_amount: string | null;
			assets: Array<{
				payment_method_id: string;
				payment_method_name: string;
				required_confirmations: number;
				asset_code: string;
				decimals: number;
			}>;
		}
	>();
	for (const row of rows.results) {
		const current = grouped.get(row.id) ?? {
			...row,
			min_amount:
				row.min_amount_minor === null
					? null
					: unitsToDecimal(
							BigInt(row.min_amount_minor),
							receivingLimitDecimals,
						),
			max_amount:
				row.max_amount_minor === null
					? null
					: unitsToDecimal(
							BigInt(row.max_amount_minor),
							receivingLimitDecimals,
						),
			assets: [],
		};
		current.assets.push({
			payment_method_id: row.payment_method_id,
			payment_method_name: row.payment_method_name,
			required_confirmations: row.required_confirmations,
			asset_code: row.asset_code,
			decimals: row.decimals,
		});
		grouped.set(row.id, current);
	}
	return [...grouped.values()];
}

export const listReceivingMethodOptionsFn = createServerFn({
	method: "GET",
}).handler(async () => {
	const context = await receivingMethodContext("read");
	const methods = await context.db
		.prepare(
			`SELECT asset.id, asset.code || ' · ' || rail.name AS name,
			 asset.rail_code, rail.name AS rail_name,
				 asset.code AS asset_code, asset.decimals,
				 rail.kind AS rail_kind
				 FROM payment_assets asset
				 JOIN payment_rails rail ON rail.code = asset.rail_code
				 ORDER BY asset.rail_code, asset.code`,
		)
		.all<{
			id: string;
			name: string;
			rail_code: string;
			rail_name: string;
			asset_code: string;
			decimals: number;
			rail_kind: "chain" | "exchange" | "wallet";
		}>();
	return { methods: methods.results };
});

const createReceivingMethodInput = z.object({
	name: z.string().trim().min(1).max(100),
	paymentMethodIds: z
		.array(z.string().trim().min(1).max(100))
		.min(1)
		.max(100)
		.transform((values) => [...new Set(values)]),
	configuration: z.record(z.string(), z.string().trim().max(512)),
	minAmount: z
		.string()
		.trim()
		.regex(/^\d+(?:\.\d+)?$/)
		.optional(),
	maxAmount: z
		.string()
		.trim()
		.regex(/^\d+(?:\.\d+)?$/)
		.optional(),
});

export const createReceivingMethodFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof createReceivingMethodInput>) =>
		createReceivingMethodInput.parse(input),
	)
	.handler(async ({ data }) => {
		const context = await receivingMethodContext("create");
		const methods = await context.db
			.prepare(
				`SELECT asset.id, asset.code AS asset_code, asset.decimals,
				 rail.code, rail.kind FROM payment_assets asset
				 JOIN payment_rails rail ON rail.code = asset.rail_code
				 WHERE asset.id IN (${data.paymentMethodIds.map(() => "?").join(", ")})
				 ORDER BY asset.code`,
			)
			.bind(...data.paymentMethodIds)
			.all<{
				id: string;
				asset_code: string;
				code: string;
				kind: "chain" | "exchange" | "wallet";
				decimals: number;
			}>();
		if (methods.results.length !== data.paymentMethodIds.length)
			throw paymentSettingsError("payment_method_not_found");
		const first = methods.results[0];
		if (
			!first ||
			methods.results.some(
				(method) => method.code !== first.code || method.kind !== first.kind,
			)
		)
			throw paymentSettingsError("receiving_method_mixed_rail");
		const target = receivingTarget(first.kind, first.code, data.configuration);
		let encryptedConfiguration: string | null = null;
		if (target.credentials) {
			encryptedConfiguration = await encryptSecret(
				JSON.stringify(target.credentials),
				context.runtime.integrationConfigSecret,
			);
		}
		const now = Date.now();
		const id = crypto.randomUUID();
		const limits = parseReceivingUsdLimits(data.minAmount, data.maxAmount);
		await context.db.batch([
			context.db
				.prepare(
					`INSERT INTO receiving_methods
						(id, merchant_id, environment_id, name, rail_code, target_type, target_value,
						 normalized_target_value, target_metadata, config_encrypted,
						 min_amount_minor, max_amount_minor, enabled, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
				)
				.bind(
					id,
					context.scope.merchantId,
					context.scope.environmentId,
					data.name,
					first.code,
					target.type,
					target.value,
					target.value,
					JSON.stringify(target.metadata),
					encryptedConfiguration,
					limits.min?.toString() ?? null,
					limits.max?.toString() ?? null,
					now,
					now,
				),
			...methods.results.map((method) =>
				context.db
					.prepare(
						`INSERT INTO receiving_method_assets
						(id, receiving_method_id, payment_asset_id, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?)`,
					)
					.bind(crypto.randomUUID(), id, method.id, now, now),
			),
		]);
		try {
			await context.db.batch([
				context.db
					.prepare(
						`UPDATE receiving_methods SET enabled = 1, updated_at = ?
						 WHERE id = ? AND merchant_id IS ? AND environment_id IS ?`,
					)
					.bind(now, id, context.scope.merchantId, context.scope.environmentId),
				context.db
					.prepare(
						`UPDATE payment_ingresses SET reconcile_required_at = ?, updated_at = ?
						 WHERE enabled = 1 AND merchant_id IS ? AND environment_id IS ?
						 AND network = (
						  SELECT rail_code FROM receiving_methods
						  WHERE id = ? AND merchant_id IS ? AND environment_id IS ?
						 ) AND changes() = 1`,
					)
					.bind(
						now,
						now,
						context.scope.merchantId,
						context.scope.environmentId,
						id,
						context.scope.merchantId,
						context.scope.environmentId,
					),
				context.db
					.prepare(
						`INSERT INTO audit_logs
					(id, actor_user_id, action, target_type, target_id, request_id, ip_address, after, created_at)
					VALUES (?, ?, 'receiving_method.created', 'receiving_method', ?, ?, ?, ?, ?)`,
					)
					.bind(
						crypto.randomUUID(),
						context.user.id,
						id,
						context.request.headers.get("x-request-id"),
						context.request.headers.get("cf-connecting-ip"),
						JSON.stringify({
							name: data.name,
							railCode: first.code,
							paymentMethodIds: methods.results.map((method) => method.id),
							assetCodes: methods.results.map((method) => method.asset_code),
							minAmountMinor: limits.min?.toString() ?? null,
							maxAmountMinor: limits.max?.toString() ?? null,
							targetType: target.type,
							enabled: true,
						}),
						now,
					),
			]);
		} catch (error) {
			await context.db
				.prepare(
					"DELETE FROM receiving_methods WHERE id = ? AND merchant_id IS ? AND environment_id IS ?",
				)
				.bind(id, context.scope.merchantId, context.scope.environmentId)
				.run();
			throw error;
		}
		return { id };
	});

const updateReceivingMethodInput = createReceivingMethodInput
	.pick({ name: true, minAmount: true, maxAmount: true })
	.extend({
		id: z.string().trim().min(1).max(100),
		address: z.string().trim().min(1).max(512).optional(),
	});

export const updateReceivingMethodFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof updateReceivingMethodInput>) =>
		updateReceivingMethodInput.parse(input),
	)
	.handler(async ({ data }) => {
		const context = await receivingMethodContext("update");
		return updateReceivingMethod(
			context.db,
			data,
			{
				actorUserId: context.user.id,
				requestId: context.request.headers.get("x-request-id"),
				ipAddress: context.request.headers.get("cf-connecting-ip"),
			},
			context.scope,
		);
	});

type ReceivingMethodUpdate = z.input<typeof updateReceivingMethodInput>;

type ReceivingMethodAudit = {
	actorUserId: string | null;
	requestId: string | null;
	ipAddress: string | null;
};

export async function updateReceivingMethod(
	db: D1Database,
	input: ReceivingMethodUpdate,
	audit: ReceivingMethodAudit,
	scope: MerchantEnvironmentContext,
) {
	const current = await db
		.prepare(
			`SELECT name, rail_code, target_type, target_value,
			 min_amount_minor, max_amount_minor
			 FROM receiving_methods
			 WHERE id = ? AND merchant_id IS ? AND environment_id IS ?`,
		)
		.bind(input.id, scope.merchantId, scope.environmentId)
		.first<{
			name: string;
			rail_code: string;
			target_type: "address" | "account" | "provider";
			target_value: string;
			min_amount_minor: string | null;
			max_amount_minor: string | null;
		}>();
	if (!current) throw paymentSettingsError("receiving_method_not_found");
	const target =
		current.target_type === "address" && input.address !== undefined
			? receivingTarget("chain", current.rail_code, { address: input.address })
			: {
					type: current.target_type,
					value: current.target_value,
					metadata: undefined,
				};
	const limits = parseReceivingUsdLimits(input.minAmount, input.maxAmount);
	const minAmountMinor = limits.min?.toString() ?? null;
	const maxAmountMinor = limits.max?.toString() ?? null;
	const limitsChanged =
		current.min_amount_minor !== minAmountMinor ||
		current.max_amount_minor !== maxAmountMinor;
	const targetChanged = current.target_value !== target.value;
	const now = Date.now();
	await db.batch([
		db
			.prepare(
				`UPDATE receiving_methods SET name = ?, target_value = ?,
				 normalized_target_value = ?, target_metadata = COALESCE(?, target_metadata),
				 min_amount_minor = ?, max_amount_minor = ?, updated_at = ?
				 WHERE id = ? AND merchant_id IS ? AND environment_id IS ?`,
			)
			.bind(
				input.name,
				target.value,
				target.value,
				target.metadata ? JSON.stringify(target.metadata) : null,
				minAmountMinor,
				maxAmountMinor,
				now,
				input.id,
				scope.merchantId,
				scope.environmentId,
			),
		db
			.prepare(
				`UPDATE payment_ingresses SET reconcile_required_at = ?, updated_at = ?
				 WHERE enabled = 1 AND merchant_id IS ? AND environment_id IS ?
				 AND network = ? AND ? = 1`,
			)
			.bind(
				now,
				now,
				scope.merchantId,
				scope.environmentId,
				current.rail_code,
				targetChanged ? 1 : 0,
			),
		db
			.prepare(
				`INSERT INTO audit_logs
				 (id, actor_user_id, action, target_type, target_id, request_id,
				  ip_address, before, after, created_at)
				 VALUES (?, ?, 'receiving_method.updated', 'receiving_method',
				  ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				crypto.randomUUID(),
				audit.actorUserId,
				input.id,
				audit.requestId,
				audit.ipAddress,
				JSON.stringify({
					name: current.name,
					targetValue: current.target_value,
					minAmountMinor: current.min_amount_minor,
					maxAmountMinor: current.max_amount_minor,
				}),
				JSON.stringify({
					name: input.name,
					targetValue: target.value,
					minAmountMinor,
					maxAmountMinor,
					limitsChanged,
					targetChanged,
				}),
				now,
			),
	]);
	return { id: input.id, limitsChanged, targetChanged };
}

export const deleteReceivingMethodFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof receivingMethodIdInput>) =>
		receivingMethodIdInput.parse(input),
	)
	.handler(async ({ data }) => {
		const context = await receivingMethodContext("delete");
		return deleteReceivingMethod(
			context.db,
			data.id,
			{
				actorUserId: context.user.id,
				requestId: context.request.headers.get("x-request-id"),
				ipAddress: context.request.headers.get("cf-connecting-ip"),
			},
			context.scope,
		);
	});

function receivingTarget(
	kind: "chain" | "exchange" | "wallet",
	railCode: string,
	configuration: Record<string, string>,
) {
	if (kind !== "chain") {
		const parsed = parseReceivingProviderConfiguration(railCode, configuration);
		return {
			type: parsed.targetType,
			value: parsed.targetValue,
			metadata: { [parsed.targetField]: parsed.targetValue },
			credentials: parsed.credentials,
		};
	}
	const value = configuration.address?.trim();
	if (!value)
		throw paymentSettingsError("receiving_method_configuration_required");
	return {
		type: "address" as const,
		value,
		metadata: { address: value },
		credentials: null,
	};
}

export const setReceivingMethodEnabledFn = createServerFn({ method: "POST" })
	.validator((input: { id: string; enabled: boolean }) =>
		receivingMethodIdInput.extend({ enabled: z.boolean() }).parse(input),
	)
	.handler(async ({ data }) => {
		const context = await receivingMethodContext("update");
		const now = Date.now();
		const [result] = await context.db.batch([
			context.db
				.prepare(
					`UPDATE receiving_methods SET enabled = ?, updated_at = ?
					 WHERE id = ? AND merchant_id IS ? AND environment_id IS ? AND enabled != ?`,
				)
				.bind(
					data.enabled,
					now,
					data.id,
					context.scope.merchantId,
					context.scope.environmentId,
					data.enabled,
				),
			context.db
				.prepare(
					`UPDATE payment_ingresses SET reconcile_required_at = ?, updated_at = ?
						 WHERE enabled = 1 AND merchant_id IS ? AND environment_id IS ?
						 AND network = (
						  SELECT rail_code FROM receiving_methods
						  WHERE id = ? AND merchant_id IS ? AND environment_id IS ?
						 ) AND changes() = 1`,
				)
				.bind(
					now,
					now,
					context.scope.merchantId,
					context.scope.environmentId,
					data.id,
					context.scope.merchantId,
					context.scope.environmentId,
				),
		]);
		const changed = (result?.meta.changes ?? 0) === 1;
		if (changed)
			await context.db
				.prepare(
					`INSERT INTO audit_logs
					 (id, actor_user_id, action, target_type, target_id, request_id, ip_address, after, created_at)
					 VALUES (?, ?, 'receiving_method.enabled_changed', 'receiving_method', ?, ?, ?, ?, ?)`,
				)
				.bind(
					crypto.randomUUID(),
					context.user.id,
					data.id,
					context.request.headers.get("x-request-id"),
					context.request.headers.get("cf-connecting-ip"),
					JSON.stringify({ enabled: data.enabled }),
					now,
				)
				.run();
		return { ...data, changed };
	});

const merchantPermissionMasks = {
	read: 1,
	create: 2,
	update: 4,
	delete: 8,
} as const;

type ReceivingMethodAction = keyof typeof merchantPermissionMasks;

async function receivingMethodContext(action: ReceivingMethodAction) {
	try {
		const context = await adminContext(
			systemPermission("receiving_methods", action),
		);
		return {
			...context,
			scope: await selectedMerchantContext(context.request),
		};
	} catch (error) {
		if (!(error instanceof AccessDeniedError) || error.status !== 403)
			throw error;
		const request = getRequest();
		const access = await requireMerchantAccess(request, {
			module: "merchant",
			permissionMask: merchantPermissionMasks[action],
		});
		const env = getCloudflareEnv(request);
		if (!env.DB) throw new Error("D1 binding DB is unavailable");
		const runtime = await loadRequestRuntimeConfig(
			request,
			env.DB,
			new URL(request.url).origin,
		);
		if (!runtime.integrationConfigSecret)
			throw new Error("INTEGRATION_CONFIG_SECRET is not configured");
		return {
			db: env.DB,
			env,
			request,
			runtime,
			user: access,
			scope: access.context,
		};
	}
}

async function selectedMerchantContext(request: Request) {
	const session = await loadMerchantSession(request);
	try {
		return await loadMerchantContext(request, session);
	} catch (error) {
		if (!(error instanceof AccessDeniedError) || !session.root) throw error;
		const env = getCloudflareEnv(request);
		if (!env.DB) throw new Error("D1 binding DB is unavailable");
		const context = await findDefaultMerchantContext(
			env.DB,
			session.user.id,
			true,
		);
		if (!context) throw error;
		setResponseHeader("set-cookie", await setMerchantContext(request, context));
		return context;
	}
}
