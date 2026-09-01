import type { OrderStatus } from "#/features/orders/schema";
import type { MerchantAccessContext } from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";
import { redactSerializedAuditValue } from "#/server/audit-redaction";

export type PaymentTestTimelineEventKind =
	| "run.created"
	| "order.created"
	| "payment.observed"
	| "webhook.event"
	| "webhook.delivery"
	| "webhook.attempt"
	| "callback.received"
	| "audit.recorded";

export type PaymentTestTimelineEvent = {
	id: string;
	kind: PaymentTestTimelineEventKind;
	occurredAt: number;
	priority: number;
	status: string | null;
	detail: unknown;
};

type RunSummary = {
	id: string;
	protocol: "gmpay" | "epay";
	payment_mode: "simulator" | "testnet" | "live";
	status: string;
	expected_outcome: string;
	callback_mode: "builtin" | "custom";
	scenario: string | null;
	scenario_step: number;
	order_id: string;
	order_status: OrderStatus;
	external_order_id: string;
	created_at: number;
};

export async function reconcilePaymentTestRun(db: D1Database, runId: string) {
	const row = await db
		.prepare(
			`SELECT run.status, run.expected_outcome, run.callback_mode,
			 run.scenario_step, order_record.status AS order_status,
			 EXISTS(SELECT 1 FROM order_payments payment
			  WHERE payment.order_id = run.order_id AND payment.status = 'rejected') AS rejected_payment,
			 EXISTS(SELECT 1 FROM webhook_events event
			  WHERE event.order_id = run.order_id AND event.type = 'payment.late_detected') AS late_payment,
			 EXISTS(SELECT 1 FROM payment_test_callback_receipts receipt
			  WHERE receipt.run_id = run.id AND receipt.signature_status = 'valid') AS valid_receipt,
			 COALESCE((SELECT MAX(receipt.attempt) FROM payment_test_callback_receipts receipt
			  WHERE receipt.run_id = run.id AND receipt.signature_status = 'valid'), 0) AS receipt_attempt,
			 EXISTS(SELECT 1 FROM webhook_deliveries delivery
			  WHERE delivery.order_id = run.order_id AND delivery.status = 'succeeded') AS succeeded_delivery,
			 COALESCE((SELECT MAX(delivery.attempt_count) FROM webhook_deliveries delivery
			  WHERE delivery.order_id = run.order_id AND delivery.status = 'succeeded'), 0) AS delivery_attempt,
			 EXISTS(SELECT 1 FROM webhook_deliveries delivery
			  WHERE delivery.order_id = run.order_id AND delivery.status = 'dead') AS dead_delivery
			 FROM payment_test_runs run
			 JOIN orders order_record ON order_record.id = run.order_id
			 WHERE run.id = ? LIMIT 1`,
		)
		.bind(runId)
		.first<{
			status: string;
			expected_outcome: string;
			callback_mode: "builtin" | "custom";
			scenario_step: number;
			order_status: OrderStatus;
			rejected_payment: number;
			late_payment: number;
			valid_receipt: number;
			receipt_attempt: number;
			succeeded_delivery: number;
			delivery_attempt: number;
			dead_delivery: number;
		}>();
	if (!row || !["running", "ready"].includes(row.status)) return row?.status;
	const callbackSucceeded =
		row.callback_mode === "builtin"
			? row.valid_receipt === 1
			: row.succeeded_delivery === 1;
	const callbackAttempt =
		row.callback_mode === "builtin"
			? row.receipt_attempt
			: row.delivery_attempt;
	const outcomeReached = expectedOutcomeReached(row, callbackAttempt);
	const now = Date.now();
	if (outcomeReached && callbackSucceeded) {
		await db
			.prepare(
				"UPDATE payment_test_runs SET status = 'passed', failure_code = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status IN ('ready','running')",
			)
			.bind(now, now, runId)
			.run();
		return "passed";
	}
	if (row.dead_delivery === 1 || row.order_status === "failed") {
		const failureCode =
			row.dead_delivery === 1 ? "callback_delivery_dead" : "order_failed";
		await db
			.prepare(
				"UPDATE payment_test_runs SET status = 'failed', failure_code = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status IN ('ready','running')",
			)
			.bind(failureCode, now, now, runId)
			.run();
		return "failed";
	}
	return row.status;
}

export async function loadPaymentTestTimeline(
	db: D1Database,
	context: MerchantAccessContext,
	runId: string,
) {
	const run = await db
		.prepare(
			`SELECT run.id, run.protocol, run.payment_mode, run.status,
			 run.expected_outcome, run.callback_mode, run.scenario, run.scenario_step,
			 run.order_id, order_record.status AS order_status,
			 order_record.external_order_id, run.created_at
			 FROM payment_test_runs run
			 JOIN orders order_record ON order_record.id = run.order_id
			 WHERE run.id = ? AND run.merchant_id = ? AND run.environment_id = ?
			 LIMIT 1`,
		)
		.bind(runId, context.merchantId, context.environmentId)
		.first<RunSummary>();
	if (!run)
		throw new DomainError(
			"payment_test_run_not_found",
			404,
			"Payment test run was not found.",
		);
	const reconciledStatus = await reconcilePaymentTestRun(db, runId);
	if (reconciledStatus) run.status = reconciledStatus;
	const statements = timelineStatements(db, run);
	const results = await db.batch(statements);
	const rows = results.flatMap(
		(result) => (result as D1Result<TimelineRow>).results,
	);
	const events = rows
		.map(
			(row): PaymentTestTimelineEvent => ({
				id: row.id,
				kind: row.kind,
				occurredAt: row.occurred_at,
				priority: row.priority,
				status: row.status,
				detail:
					row.kind === "audit.recorded"
						? redactSerializedAuditValue(row.detail)
						: parseDetail(row.detail),
			}),
		)
		.sort(
			(left, right) =>
				left.occurredAt - right.occurredAt ||
				left.priority - right.priority ||
				left.id.localeCompare(right.id),
		);
	return {
		run: {
			id: run.id,
			protocol: run.protocol,
			mode: run.payment_mode,
			status: run.status,
			expectedOutcome: run.expected_outcome,
			callbackMode: run.callback_mode,
			scenario: run.scenario,
			scenarioStep: run.scenario_step,
			orderId: run.order_id,
			orderStatus: run.order_status,
			externalOrderId: run.external_order_id,
			createdAt: run.created_at,
		},
		events,
	};
}

type TimelineRow = {
	id: string;
	kind: PaymentTestTimelineEventKind;
	occurred_at: number;
	priority: number;
	status: string | null;
	detail: string | null;
};

function timelineStatements(db: D1Database, run: RunSummary) {
	const orderId = run.order_id;
	return [
		db
			.prepare(
				`SELECT 'run:' || id AS id, 'run.created' AS kind,
				 created_at AS occurred_at, 10 AS priority, status,
				 json_object('scenario', scenario, 'step', scenario_step) AS detail
				 FROM payment_test_runs WHERE id = ?`,
			)
			.bind(run.id),
		db
			.prepare(
				`SELECT 'order:' || id AS id, 'order.created' AS kind,
				 created_at AS occurred_at, 20 AS priority, status,
				 json_object('externalOrderId', external_order_id) AS detail
				 FROM orders WHERE id = ?`,
			)
			.bind(orderId),
		db
			.prepare(
				`SELECT 'payment:' || id AS id, 'payment.observed' AS kind,
				 detected_at AS occurred_at, 30 AS priority, status,
				 json_object('transactionId', transaction_id, 'amountUnits', amount_units,
				 'confirmations', confirmations) AS detail
				 FROM order_payments WHERE order_id = ?`,
			)
			.bind(orderId),
		db
			.prepare(
				`SELECT 'event:' || id AS id, 'webhook.event' AS kind,
				 created_at AS occurred_at, 40 AS priority, type AS status, payload AS detail
				 FROM webhook_events WHERE order_id = ?`,
			)
			.bind(orderId),
		db
			.prepare(
				`SELECT 'delivery:' || id AS id, 'webhook.delivery' AS kind,
				 created_at AS occurred_at, 50 AS priority, status,
				 json_object('attemptCount', attempt_count) AS detail
				 FROM webhook_deliveries WHERE order_id = ?`,
			)
			.bind(orderId),
		db
			.prepare(
				`SELECT 'attempt:' || attempt.id AS id, 'webhook.attempt' AS kind,
				 attempt.attempted_at AS occurred_at, 60 AS priority,
				 COALESCE(attempt.error_code, 'succeeded') AS status,
				 json_object('attempt', attempt.attempt,
				 'responseStatus', attempt.response_status,
				 'durationMs', attempt.duration_ms) AS detail
				 FROM webhook_attempts attempt
				 JOIN webhook_deliveries delivery ON delivery.id = attempt.delivery_id
				 WHERE delivery.order_id = ?`,
			)
			.bind(orderId),
		db
			.prepare(
				`SELECT 'receipt:' || id AS id, 'callback.received' AS kind,
				 received_at AS occurred_at, 70 AS priority, signature_status AS status,
				 json_object('attempt', attempt,
				 'acknowledgement', response_acknowledgement) AS detail
				 FROM payment_test_callback_receipts WHERE run_id = ?`,
			)
			.bind(run.id),
		db
			.prepare(
				`SELECT 'audit:' || id AS id, 'audit.recorded' AS kind,
				 created_at AS occurred_at, 80 AS priority, action AS status, after AS detail
				 FROM audit_logs WHERE (target_type = 'payment_test_run' AND target_id = ?)
				 OR (target_type = 'order' AND target_id = ?)`,
			)
			.bind(run.id, orderId),
	];
}

function expectedOutcomeReached(
	row: {
		expected_outcome: string;
		order_status: OrderStatus;
		rejected_payment: number;
		late_payment: number;
		scenario_step: number;
	},
	callbackAttempt: number,
) {
	switch (row.expected_outcome) {
		case "paid":
			return row.order_status === "paid";
		case "partial":
			return row.order_status === "partially_paid";
		case "overpaid":
			return row.order_status === "overpaid";
		case "failed_payment":
			return row.rejected_payment === 1;
		case "late_payment":
			return row.order_status === "expired" && row.late_payment === 1;
		case "reorg_recovered":
			return row.order_status === "paid" && row.scenario_step >= 3;
		case "callback_retry_succeeded":
			return row.order_status === "paid" && callbackAttempt >= 2;
		default:
			return false;
	}
}

function parseDetail(value: string | null) {
	try {
		return value === null ? null : (JSON.parse(value) as unknown);
	} catch {
		return null;
	}
}
