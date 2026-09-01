import {
	ReceivingMethodNotReadyError,
	type ReceivingMethodReadiness,
	type ReceivingMethodReadinessReason,
} from "#/features/payment-settings/readiness";
import { createReceivingMethodAdapters } from "#/features/payment-settings/server/method-adapter";
import { assertPaymentModeAllowed } from "#/features/payment-testing/environment";
import type {
	PaymentEnvironmentCode,
	PaymentNetworkClass,
	PaymentTestMode,
} from "#/features/payment-testing/types";

type ReceivingMethodReadinessRow = {
	id: string;
	enabled: number;
	asset_kind: "native" | "token" | "external";
	contract_address: string | null;
	rail_code: string;
	network_class: PaymentNetworkClass;
	connection_enabled: number;
	connection_healthy: number;
	payment_method_id: string;
	target_value: string;
};

export async function checkReceivingMethodReadiness(
	db: D1Database,
	methodId: string,
	options: {
		requireEnabled?: boolean;
		now?: number;
		validateTarget?: boolean;
		merchantId?: string;
		environmentId?: string;
		environmentCode?: PaymentEnvironmentCode;
		paymentMode?: PaymentTestMode;
	} = {},
): Promise<ReceivingMethodReadiness> {
	const checkedAt = options.now ?? Date.now();
	const scope =
		options.merchantId !== undefined && options.environmentId !== undefined
			? {
					merchantId: options.merchantId,
					environmentId: options.environmentId,
				}
			: undefined;
	const methods = await db
		.prepare(
			`SELECT rm.id, rm.enabled, link.payment_asset_id AS payment_method_id,
			 rm.target_value,
			 pa.kind AS asset_kind, pa.contract_address,
			 pr.code AS rail_code, pr.network_class,
			 EXISTS (SELECT 1 FROM payment_ingresses pc WHERE pc.rail_code = pa.rail_code
			  AND pc.enabled = 1
			  AND (? = 0 OR (pc.merchant_id IS ? AND pc.environment_id IS ?))) AS connection_enabled,
			 EXISTS (SELECT 1 FROM payment_ingresses pc WHERE pc.rail_code = pa.rail_code
			  AND pc.enabled = 1
			  AND (? = 0 OR (pc.merchant_id IS ? AND pc.environment_id IS ?))
			  AND (pr.kind IN ('exchange', 'wallet') OR pc.health_status = 'healthy')) AS connection_healthy
			 FROM receiving_methods rm
			 JOIN receiving_method_assets link ON link.receiving_method_id = rm.id
			 JOIN payment_assets pa ON pa.id = link.payment_asset_id
			 JOIN payment_rails pr ON pr.code = pa.rail_code
			 WHERE rm.id = ?
			 AND (? = 0 OR (rm.merchant_id IS ? AND rm.environment_id IS ?))`,
		)
		.bind(
			scope ? 1 : 0,
			scope?.merchantId ?? null,
			scope?.environmentId ?? null,
			scope ? 1 : 0,
			scope?.merchantId ?? null,
			scope?.environmentId ?? null,
			methodId,
			scope ? 1 : 0,
			scope?.merchantId ?? null,
			scope?.environmentId ?? null,
		)
		.all<ReceivingMethodReadinessRow>();
	const method = methods.results[0];
	if (!method)
		return result(methodId, checkedAt, "unsupported", [
			reason("METHOD_NOT_FOUND", "Receiving method does not exist."),
		]);
	if (options.environmentCode && options.paymentMode) {
		try {
			assertPaymentModeAllowed(
				options.environmentCode,
				options.paymentMode,
				method.network_class,
			);
		} catch {
			return result(methodId, checkedAt, "unsupported", [
				reason(
					"ENVIRONMENT_MISMATCH",
					"The receiving method is not available in this payment mode.",
				),
			]);
		}
	}
	if (
		methods.results.some(
			(row) => row.asset_kind === "token" && !row.contract_address,
		)
	)
		return result(methodId, checkedAt, "unsupported", [
			reason("INVALID_ASSET", "The token contract is not configured."),
		]);
	if ((options.requireEnabled ?? true) && !method.enabled)
		return result(methodId, checkedAt, "disabled", [
			reason("METHOD_DISABLED", "The receiving method is disabled."),
		]);
	if (method.network_class !== "simulated" && !method.connection_enabled)
		return result(methodId, checkedAt, "missing_connection", [
			reason("MISSING_CONNECTION", "Configure an enabled payment connection."),
		]);
	if (method.network_class !== "simulated" && !method.connection_healthy)
		return result(methodId, checkedAt, "unhealthy", [
			reason(
				"UNHEALTHY_CONNECTION",
				"No enabled connection has passed its health check.",
			),
		]);
	if (!method.target_value.trim())
		return result(methodId, checkedAt, "missing_target", [
			reason("MISSING_TARGET", "Configure the receiving target."),
		]);
	let adapters: Awaited<ReturnType<typeof createReceivingMethodAdapters>>;
	try {
		adapters = await createReceivingMethodAdapters(
			db,
			method.id,
			undefined,
			scope,
		);
	} catch {
		return result(methodId, checkedAt, "missing_target", [
			reason("INVALID_TARGET", "The receiving configuration is invalid."),
		]);
	}
	const targetValid = await Promise.all(
		adapters.map(async ({ adapter }) => {
			if (!adapter.validateAddress(method.target_value)) return false;
			if (!(options.validateTarget && adapter.validateTarget)) return true;
			try {
				return await adapter.validateTarget(method.target_value);
			} catch {
				return false;
			}
		}),
	);
	if (!targetValid.some(Boolean))
		return result(methodId, checkedAt, "missing_target", [
			reason("INVALID_TARGET", "The receiving target is invalid."),
		]);
	return result(methodId, checkedAt, "ready", []);
}

export async function assertReceivingMethodReadyForEnable(
	db: D1Database,
	methodId: string,
	scope?: { merchantId: string; environmentId: string },
) {
	const readiness = await checkReceivingMethodReadiness(db, methodId, {
		requireEnabled: false,
		validateTarget: true,
		...scope,
	});
	if (!readiness.ready) throw new ReceivingMethodNotReadyError(readiness);
	return readiness;
}

function result(
	methodId: string,
	checkedAt: number,
	status: ReceivingMethodReadiness["status"],
	reasons: ReceivingMethodReadinessReason[],
): ReceivingMethodReadiness {
	return {
		receivingMethodId: methodId,
		ready: status === "ready",
		status,
		reasons,
		checkedAt,
	};
}

function reason(
	code: ReceivingMethodReadinessReason["code"],
	message: string,
): ReceivingMethodReadinessReason {
	return { code, message };
}
