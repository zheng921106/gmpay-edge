import type { SimulatorScenario } from "#/features/payment-testing/server/simulator";
import type {
	PaymentEnvironmentCode,
	PaymentTestMode,
	PaymentTestProtocol,
} from "#/features/payment-testing/types";
import { simulatorScenarios } from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";

const MAX_SNAPSHOT_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

export const paymentTestOperationIds = [
	"preflight",
	"protocol_request",
	"order_create",
	"payment_detect",
	"confirmation",
	"callback_delivery",
] as const;

type PaymentTestOperationMetric = {
	operation: (typeof paymentTestOperationIds)[number];
	protocol: PaymentTestProtocol | null;
	environment: PaymentEnvironmentCode;
	mode: PaymentTestMode | null;
	scenario: SimulatorScenario | null;
	result: "success" | "failure";
	errorCode: string | null;
	durationMs: number;
};

export function recordPaymentTestOperation(metric: PaymentTestOperationMetric) {
	console.info({
		event: "payment_test_operation",
		...metric,
		errorCode: normalizeErrorCode(metric.errorCode),
		durationMs: Math.round(Math.max(0, metric.durationMs) * 10) / 10,
	});
}

export async function observePaymentTestOperation<T>(
	metric: Omit<
		PaymentTestOperationMetric,
		"durationMs" | "errorCode" | "result"
	>,
	run: () => Promise<T>,
) {
	const startedAt = performance.now();
	try {
		const result = await run();
		recordPaymentTestOperation({
			...metric,
			result: "success",
			errorCode: null,
			durationMs: performance.now() - startedAt,
		});
		return result;
	} catch (error) {
		recordPaymentTestOperation({
			...metric,
			result: "failure",
			errorCode: paymentTestErrorCode(error),
			durationMs: performance.now() - startedAt,
		});
		throw error;
	}
}

export async function recordPaymentTestCallbackDelivery(
	db: D1Database,
	runId: string,
	result: { success: boolean; durationMs: number; errorCode?: string },
) {
	try {
		const row = await db
			.prepare(
				`SELECT run.protocol, run.payment_mode, run.scenario, environment.code
				 FROM payment_test_runs run
				 JOIN merchant_environments environment ON environment.id = run.environment_id
				 WHERE run.id = ? LIMIT 1`,
			)
			.bind(runId)
			.first<{
				protocol: PaymentTestProtocol;
				payment_mode: PaymentTestMode;
				scenario: string | null;
				code: PaymentEnvironmentCode;
			}>();
		if (!row) return;
		recordPaymentTestOperation({
			operation: "callback_delivery",
			protocol: row.protocol,
			environment: row.code,
			mode: row.payment_mode,
			scenario: isSimulatorScenario(row.scenario) ? row.scenario : null,
			result: result.success ? "success" : "failure",
			errorCode: result.success
				? null
				: (result.errorCode ?? "delivery_failed"),
			durationMs: result.durationMs,
		});
	} catch {
		// Observability must not change payment delivery behavior.
	}
}

export function redactPaymentTestSnapshot(value: unknown): unknown {
	const redacted = redactValue(value);
	const bytes = textEncoder.encode(JSON.stringify(redacted)).byteLength;
	if (bytes <= MAX_SNAPSHOT_BYTES) return redacted;
	return {
		truncated: true,
		originalBytes: bytes,
		redacted: "[REDACTED]",
	};
}

export function isPaymentTestSensitiveKey(key: string) {
	const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
	return /(?:^|[_-])(signature|sign|authorization|cookie|token|secret|password)(?:$|[_-])/.test(
		normalized,
	);
}

function redactValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			isPaymentTestSensitiveKey(key) ? "[REDACTED]" : redactValue(entry),
		]),
	);
}

function paymentTestErrorCode(error: unknown) {
	if (error instanceof DomainError) return error.code;
	if (error instanceof DOMException && error.name === "TimeoutError")
		return "timeout";
	return "payment_test_failed";
}

function normalizeErrorCode(value: string | null) {
	if (value === null) return null;
	return /^[a-z0-9_]{1,64}$/.test(value) ? value : "payment_test_failed";
}

function isSimulatorScenario(value: string | null): value is SimulatorScenario {
	return simulatorScenarios.some((scenario) => scenario === value);
}
