import {
	callbackDestinationSnapshot,
	type PaymentTestStartInput,
	parsePaymentTestStartInput,
	parseStoredPaymentTestInput,
} from "#/features/payment-testing/schema";
import { issueProductionConfirmation } from "#/features/payment-testing/server/confirmation";
import {
	isPaymentTestSensitiveKey,
	redactPaymentTestSnapshot,
} from "#/features/payment-testing/server/observability";
import { preflightPaymentTest } from "#/features/payment-testing/server/preflight";
import { executePaymentTestRun } from "#/features/payment-testing/server/protocol-request";
import type {
	MerchantAccessContext,
	PaymentTestRuntime,
	PaymentTestStartResult,
	RedactedProtocolSnapshot,
} from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";

export async function startPaymentTestRun(
	env: PaymentTestRuntime,
	context: MerchantAccessContext,
	value: PaymentTestStartInput,
): Promise<PaymentTestStartResult> {
	const input = parsePaymentTestStartInput(value);
	await preflightPaymentTest(env.DB, context, input);
	assertPaymentTestQueues(env, input.paymentMode);
	const runId = crypto.randomUUID();
	const now = Date.now();
	const storedInput = sanitizePaymentTestInputForStorage(input);
	const inputSnapshot: RedactedProtocolSnapshot = {
		version: 1,
		method: "POST",
		path: "/admin/test-center/runs",
		headers: {},
		body: storedInput,
	};
	const confirmation =
		input.paymentMode === "live"
			? await issueProductionConfirmation(
					runId,
					context,
					storedInput,
					now,
					env.DB,
				)
			: null;
	const inserted = await env.DB.prepare(
		`INSERT OR IGNORE INTO payment_test_runs
			 (id, merchant_id, environment_id, created_by_user_id, protocol, payment_mode,
			  api_key_id, external_order_id, callback_mode, callback_destination_snapshot,
			  status, expected_outcome, idempotency_key, request_snapshot,
			  confirmation_nonce_hash, confirmation_expires_at, started_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			runId,
			context.merchantId,
			context.environmentId,
			context.userId,
			input.protocol,
			input.paymentMode,
			input.apiKeyId,
			input.externalOrderId,
			input.callback.mode,
			JSON.stringify(callbackDestinationSnapshot(input)),
			input.paymentMode === "live" ? "ready" : "running",
			input.expectedOutcome,
			input.clientIdempotencyKey,
			JSON.stringify(inputSnapshot),
			confirmation?.nonceHash ?? null,
			confirmation?.expiresAt ?? null,
			input.paymentMode === "live" ? null : now,
			now,
			now,
		)
		.run();
	if ((inserted.meta.changes ?? 0) === 0)
		return existingPaymentTestRun(env.DB, context, input);
	if (confirmation)
		return {
			runId,
			orderId: null,
			status: "ready",
			confirmationRequired: true,
			confirmationToken: confirmation.token,
		};
	return executePaymentTestRun(env, context, runId, input);
}

function assertPaymentTestQueues(
	env: PaymentTestRuntime,
	mode: PaymentTestStartInput["paymentMode"],
) {
	if (!env.WEBHOOK_QUEUE || (mode !== "simulator" && !env.PAYMENT_QUEUE))
		throw new DomainError(
			"payment_test_queue_unavailable",
			503,
			"Required payment test queues are unavailable.",
		);
}

async function existingPaymentTestRun(
	db: D1Database,
	context: MerchantAccessContext,
	input: PaymentTestStartInput,
): Promise<PaymentTestStartResult> {
	const row = await db
		.prepare(
			`SELECT run.id, run.order_id, run.status, run.external_order_id,
			 run.callback_mode, run.request_snapshot,
			 order_record.amount_minor, order_record.currency,
			 snapshot.receiving_method_id, order_record.payment_asset_id
			 FROM payment_test_runs run
			 LEFT JOIN orders order_record ON order_record.id = run.order_id
			 LEFT JOIN order_payment_snapshots snapshot ON snapshot.order_id = run.order_id
			 WHERE run.merchant_id = ? AND run.environment_id = ?
			 AND run.protocol = ? AND run.api_key_id = ? AND run.idempotency_key = ?
			 LIMIT 1`,
		)
		.bind(
			context.merchantId,
			context.environmentId,
			input.protocol,
			input.apiKeyId,
			input.clientIdempotencyKey,
		)
		.first<{
			id: string;
			order_id: string | null;
			status: PaymentTestStartResult["status"];
			external_order_id: string;
			callback_mode: string;
			request_snapshot: string | null;
			amount_minor: string | null;
			currency: string | null;
			receiving_method_id: string | null;
			payment_asset_id: string | null;
		}>();
	if (!row) throw idempotencyConflict();
	if (row.order_id) {
		if (
			row.external_order_id !== input.externalOrderId ||
			row.callback_mode !== input.callback.mode ||
			row.amount_minor !== input.amountMinor ||
			row.currency !== input.currency ||
			row.receiving_method_id !== input.receivingMethodId ||
			row.payment_asset_id !== input.paymentAssetId
		)
			throw idempotencyConflict();
		return {
			runId: row.id,
			orderId: row.order_id,
			status: row.status,
			confirmationRequired: false,
		};
	}
	if (input.paymentMode === "live" && row.status === "ready") {
		const snapshot = parseStoredPaymentTestInput(row.request_snapshot);
		if (
			JSON.stringify(snapshot) !==
			JSON.stringify(sanitizePaymentTestInputForStorage(input))
		)
			throw idempotencyConflict();
		throw new DomainError(
			"payment_test_confirmation_pending",
			409,
			"A production confirmation is already pending.",
		);
	}
	return {
		runId: row.id,
		orderId: null,
		status: row.status,
		confirmationRequired: false,
	};
}

function sanitizePaymentTestInputForStorage(input: PaymentTestStartInput) {
	if (!input.rawInput) return { ...input };
	if (input.protocol === "epay") {
		const parameters = new URLSearchParams(input.rawInput);
		for (const key of parameters.keys())
			if (isPaymentTestSensitiveKey(key)) parameters.set(key, "[REDACTED]");
		return { ...input, rawInput: parameters.toString() };
	}
	try {
		const value: unknown = JSON.parse(input.rawInput);
		if (!value || typeof value !== "object" || Array.isArray(value))
			return { ...input, rawInput: "{}" };
		const record = redactPaymentTestSnapshot(value) as Record<string, unknown>;
		return { ...input, rawInput: JSON.stringify(record) };
	} catch {
		return { ...input, rawInput: "{}" };
	}
}

function idempotencyConflict() {
	return new DomainError(
		"payment_test_idempotency_conflict",
		409,
		"The idempotency key is already used by another payment test input.",
	);
}
