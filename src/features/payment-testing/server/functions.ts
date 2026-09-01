import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { MerchantPermission } from "#/features/access/server/merchant-access";
import { requireMerchantAccess } from "#/features/access/server/merchant-access";
import {
	cancelOrderAsAdmin,
	queueAdminPaymentCheck,
} from "#/features/orders/server/admin-actions";
import {
	paymentTestConfirmationSchema,
	paymentTestRunIdSchema,
	paymentTestRunListSchema,
	paymentTestScenarioSchema,
	paymentTestStartInputSchema,
	paymentTestWebhookRetrySchema,
} from "#/features/payment-testing/schema";
import { confirmProductionPaymentTestRun } from "#/features/payment-testing/server/confirmation";
import { preflightPaymentTest } from "#/features/payment-testing/server/preflight";
import { startPaymentTestRun } from "#/features/payment-testing/server/runs";
import { advanceSimulatorScenario } from "#/features/payment-testing/server/simulator";
import { loadPaymentTestTimeline } from "#/features/payment-testing/server/timeline";
import type { MerchantAccessContext } from "#/features/payment-testing/types";
import {
	claimManualWebhookRetry,
	completeManualWebhookRetry,
	releaseManualWebhookRetry,
	requireRetryableWebhookDelivery,
} from "#/features/webhooks/server/retry";
import type { WebhookQueueMessage } from "#/features/webhooks/types";
import { DomainError } from "#/lib/domain-error";
import { getCloudflareEnv } from "#/server/db.server";

type PaymentTestRunListRow = {
	id: string;
	protocol: "gmpay" | "epay";
	payment_mode: "simulator" | "testnet" | "live";
	status: "ready" | "running" | "passed" | "failed" | "cancelled" | "expired";
	expected_outcome: string;
	callback_mode: "builtin" | "custom";
	callback_destination_snapshot: string;
	scenario: string | null;
	scenario_step: number;
	order_id: string | null;
	external_order_id: string;
	failure_code: string | null;
	started_at: number | null;
	completed_at: number | null;
	created_at: number;
};

export const listPaymentTestRunsFn = createServerFn({ method: "GET" })
	.validator((input) => paymentTestRunListSchema.parse(input))
	.handler(async ({ data }) => {
		const { db, access } = await merchantContext({
			module: "merchant",
			permissionMask: 1,
		});
		const filters = ["merchant_id = ?", "environment_id = ?"];
		const parameters: Array<string | number> = [
			access.context.merchantId,
			access.context.environmentId,
		];
		if (data.status) {
			filters.push("status = ?");
			parameters.push(data.status);
		}
		if (data.cursor) {
			filters.push("(created_at < ? OR (created_at = ? AND id < ?))");
			parameters.push(
				data.cursor.createdAt,
				data.cursor.createdAt,
				data.cursor.id,
			);
		}
		const result = await db
			.prepare(
				`SELECT id, protocol, payment_mode, status, expected_outcome,
				 callback_mode, callback_destination_snapshot, scenario, scenario_step,
				 order_id, external_order_id, failure_code, started_at, completed_at, created_at
				 FROM payment_test_runs
				 WHERE ${filters.join(" AND ")}
				 ORDER BY created_at DESC, id DESC LIMIT ?`,
			)
			.bind(...parameters, data.pageSize + 1)
			.all<PaymentTestRunListRow>();
		const page = result.results.slice(0, data.pageSize);
		const last = page.at(-1);
		return {
			items: page.map(toPaymentTestRunListItem),
			nextCursor:
				result.results.length > data.pageSize && last
					? { createdAt: last.created_at, id: last.id }
					: null,
		};
	});

export const getPaymentTestRunFn = createServerFn({ method: "GET" })
	.validator((input) => paymentTestRunIdSchema.parse(input))
	.handler(async ({ data }) => {
		const { db, context } = await merchantContext({
			module: "merchant",
			permissionMask: 1,
		});
		return loadPaymentTestTimeline(db, context, data.runId);
	});

export const preflightPaymentTestFn = createServerFn({ method: "POST" })
	.validator((input) => paymentTestStartInputSchema.parse(input))
	.handler(async ({ data }) => {
		const { db, context } = await merchantContext({
			module: "merchant",
			permissionMask: 2,
		});
		const preflight = await preflightPaymentTest(db, context, data);
		return {
			ready: preflight.ready,
			environment: preflight.environment,
			apiKey: { id: preflight.apiKey.id, pid: preflight.apiKey.pid },
			receivingMethod: preflight.receivingMethod,
			asset: preflight.asset,
			rail: preflight.rail,
		};
	});

export const startPaymentTestRunFn = createServerFn({ method: "POST" })
	.validator((input) => paymentTestStartInputSchema.parse(input))
	.handler(async ({ data }) => {
		const { env, context } = await merchantContext({
			module: "merchant",
			permissionMask: 2,
		});
		return startPaymentTestRun(env, context, data);
	});

export const confirmProductionPaymentTestRunFn = createServerFn({
	method: "POST",
})
	.validator((input) => paymentTestConfirmationSchema.parse(input))
	.handler(async ({ data }) => {
		const { env, context } = await merchantContext({
			module: "merchant",
			permissionMask: 2,
		});
		return confirmProductionPaymentTestRun(env, context, data);
	});

export const advanceSimulatorScenarioFn = createServerFn({ method: "POST" })
	.validator((input) => paymentTestScenarioSchema.parse(input))
	.handler(async ({ data }) => {
		const { env, context } = await merchantContext({
			module: "merchant",
			permissionMask: 4,
		});
		if (!env.WEBHOOK_QUEUE) throw queueUnavailable();
		return advanceSimulatorScenario(
			{ DB: env.DB, WEBHOOK_QUEUE: env.WEBHOOK_QUEUE },
			context,
			data,
		);
	});

export const refreshRealPaymentTestRunFn = createServerFn({ method: "POST" })
	.validator((input) => paymentTestRunIdSchema.parse(input))
	.handler(async ({ data }) => {
		const { db, env, request, access } = await merchantContext({
			module: "merchant",
			permissionMask: 4,
		});
		const run = await loadScopedRun(db, access.context, data.runId);
		if (!run.order_id)
			throw new DomainError(
				"payment_test_order_unavailable",
				409,
				"Payment test order is unavailable.",
			);
		if (run.payment_mode === "simulator")
			throw new DomainError(
				"payment_test_refresh_unavailable",
				409,
				"Simulator runs use scenario controls.",
			);
		if (!env.PAYMENT_QUEUE) throw queueUnavailable();
		return queueAdminPaymentCheck(
			{ DB: db, PAYMENT_QUEUE: env.PAYMENT_QUEUE },
			run.order_id,
			requestAuditContext(request, access.id),
		);
	});

export const retryPaymentTestWebhookFn = createServerFn({ method: "POST" })
	.validator((input) => paymentTestWebhookRetrySchema.parse(input))
	.handler(async ({ data }) => {
		const { db, env, request, access } = await merchantContext({
			module: "merchant",
			permissionMask: 4,
		});
		if (!env.WEBHOOK_QUEUE) throw queueUnavailable();
		const row = await db
			.prepare(
				`SELECT delivery.id, delivery.status, delivery.attempt_count,
				 event.id AS event_id
				 FROM payment_test_runs run
				 JOIN webhook_deliveries delivery ON delivery.order_id = run.order_id
				 JOIN webhook_events event ON event.id = delivery.event_id
				 WHERE run.id = ? AND delivery.id = ?
				 AND run.merchant_id = ? AND run.environment_id = ? LIMIT 1`,
			)
			.bind(
				data.runId,
				data.deliveryId,
				access.context.merchantId,
				access.context.environmentId,
			)
			.first<{
				id: string;
				status: "failed" | "dead" | "queued" | "delivering" | "succeeded";
				attempt_count: number;
				event_id: string;
			}>();
		requireRetryableWebhookDelivery(row);
		const now = Date.now();
		const claimToken =
			-Number.parseInt(crypto.randomUUID().slice(0, 8), 16) - 1;
		if (!(await claimManualWebhookRetry(db, row.id, claimToken, now)))
			throw new DomainError(
				"webhook_delivery_retry_in_progress",
				409,
				"Webhook delivery retry is already in progress.",
			);
		const message: WebhookQueueMessage = {
			kind: "webhook.delivery",
			version: 1,
			deliveryId: row.id,
			eventId: row.event_id,
			attempt: 1,
		};
		try {
			await env.WEBHOOK_QUEUE.send(message);
			await completeManualWebhookRetry(db, row.id, claimToken);
			await writeRunAudit(db, request, access.id, data.runId, {
				action: "payment_test.webhook_retried",
				deliveryId: row.id,
			});
		} catch (error) {
			await releaseManualWebhookRetry(db, row.id, claimToken, {
				status: row.status,
				attemptCount: row.attempt_count,
			});
			throw error;
		}
		return { runId: data.runId, deliveryId: row.id, status: "queued" as const };
	});

export const cancelPaymentTestRunFn = createServerFn({ method: "POST" })
	.validator((input) => paymentTestRunIdSchema.parse(input))
	.handler(async ({ data }) => {
		const { db, env, request, access } = await merchantContext({
			module: "merchant",
			permissionMask: 4,
		});
		const run = await loadScopedRun(db, access.context, data.runId);
		if (!["ready", "running"].includes(run.status))
			throw new DomainError(
				"payment_test_status_conflict",
				409,
				"Payment test run is already complete.",
			);
		if (run.order_id) {
			if (!env.WEBHOOK_QUEUE) throw queueUnavailable();
			await cancelOrderAsAdmin(
				{ DB: db, WEBHOOK_QUEUE: env.WEBHOOK_QUEUE },
				run.order_id,
				requestAuditContext(request, access.id),
			);
		}
		const now = Date.now();
		const updated = await db
			.prepare(
				`UPDATE payment_test_runs SET status = 'cancelled',
				 confirmation_consumed_at = COALESCE(confirmation_consumed_at, ?),
				 completed_at = ?, updated_at = ?
				 WHERE id = ? AND merchant_id = ? AND environment_id = ?
				 AND status IN ('ready', 'running')`,
			)
			.bind(
				now,
				now,
				now,
				data.runId,
				access.context.merchantId,
				access.context.environmentId,
			)
			.run();
		if ((updated.meta.changes ?? 0) !== 1)
			throw new DomainError(
				"payment_test_status_conflict",
				409,
				"Payment test run is already complete.",
			);
		await writeRunAudit(db, request, access.id, data.runId, {
			action: "payment_test.cancelled",
		});
		return { runId: data.runId, status: "cancelled" as const };
	});

async function merchantContext(permission: MerchantPermission) {
	const request = getRequest();
	const access = await requireMerchantAccess(request, permission);
	const env = getCloudflareEnv(request);
	if (!env.DB) throw new Error("D1 binding DB is unavailable");
	const context: MerchantAccessContext = {
		userId: access.id,
		...access.context,
		requestOrigin: new URL(request.url).origin,
	};
	return { db: env.DB, env: { ...env, DB: env.DB }, request, access, context };
}

async function loadScopedRun(
	db: D1Database,
	context: Pick<MerchantAccessContext, "merchantId" | "environmentId">,
	runId: string,
) {
	const row = await db
		.prepare(
			`SELECT id, order_id, payment_mode, status FROM payment_test_runs
			 WHERE id = ? AND merchant_id = ? AND environment_id = ? LIMIT 1`,
		)
		.bind(runId, context.merchantId, context.environmentId)
		.first<{
			id: string;
			order_id: string | null;
			payment_mode: "simulator" | "testnet" | "live";
			status: string;
		}>();
	if (!row)
		throw new DomainError(
			"payment_test_run_not_found",
			404,
			"Payment test run was not found.",
		);
	return row;
}

function toPaymentTestRunListItem(row: PaymentTestRunListRow) {
	return {
		id: row.id,
		protocol: row.protocol,
		mode: row.payment_mode,
		status: row.status,
		expectedOutcome: row.expected_outcome,
		callbackMode: row.callback_mode,
		callbackDestination: callbackDisplay(row.callback_destination_snapshot),
		scenario: row.scenario,
		scenarioStep: row.scenario_step,
		orderId: row.order_id,
		externalOrderId: row.external_order_id,
		failureCode: row.failure_code,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		createdAt: row.created_at,
	};
}

function callbackDisplay(snapshot: string) {
	try {
		const parsed: unknown = JSON.parse(snapshot);
		if (
			parsed &&
			typeof parsed === "object" &&
			"display" in parsed &&
			typeof parsed.display === "string"
		)
			return parsed.display;
	} catch {
		// Corrupt snapshots are not exposed to the client.
	}
	return "Unavailable";
}

function requestAuditContext(request: Request, actorUserId: string) {
	return {
		actorUserId,
		requestId: request.headers.get("x-request-id"),
		ipAddress: request.headers.get("cf-connecting-ip"),
	};
}

async function writeRunAudit(
	db: D1Database,
	request: Request,
	actorUserId: string,
	runId: string,
	after: Record<string, unknown>,
) {
	await db
		.prepare(
			`INSERT INTO audit_logs
			 (id, actor_user_id, action, target_type, target_id, request_id, ip_address, after, created_at)
			 VALUES (?, ?, ?, 'payment_test_run', ?, ?, ?, ?, ?)`,
		)
		.bind(
			crypto.randomUUID(),
			actorUserId,
			after.action,
			runId,
			request.headers.get("x-request-id"),
			request.headers.get("cf-connecting-ip"),
			JSON.stringify(after),
			Date.now(),
		)
		.run();
}

function queueUnavailable() {
	return new DomainError(
		"payment_test_queue_unavailable",
		503,
		"Required payment test queue is unavailable.",
	);
}
