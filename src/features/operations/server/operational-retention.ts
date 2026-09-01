const CLEANUP_BATCH_SIZE = 250;
const DEFAULT_MAX_ROWS = 2_000;
const DEFAULT_MAX_DURATION_MS = 2_000;
const AUDIT_EXPORT_BATCH_SIZE = 100;

export async function hasOperationalRetentionWork(
	db: D1Database,
	now: number,
	retentionMs: number,
	testEvidenceRetentionMs = retentionMs,
) {
	const cutoff = now - retentionMs;
	const testEvidenceCutoff = now - testEvidenceRetentionMs;
	const row = await db
		.prepare(
			`SELECT (
			 EXISTS(SELECT 1 FROM audit_exports INDEXED BY audit_exports_retention_idx
			  WHERE delete_after <= ? AND deleted_at IS NULL LIMIT 1)
			 OR EXISTS(SELECT 1 FROM webhook_attempts attempt INDEXED BY webhook_attempts_retention_idx
			  JOIN webhook_deliveries delivery ON delivery.id = attempt.delivery_id
			  WHERE attempt.attempted_at < ? AND delivery.status IN ('succeeded', 'dead')
			  AND delivery.completed_at < ? LIMIT 1)
			 OR EXISTS(SELECT 1 FROM webhook_deliveries delivery INDEXED BY webhook_deliveries_retention_idx
			  WHERE delivery.status IN ('succeeded', 'dead') AND delivery.completed_at < ?
			  AND NOT EXISTS (SELECT 1 FROM webhook_attempts attempt WHERE attempt.delivery_id = delivery.id)
			  LIMIT 1)
			 OR EXISTS(SELECT 1 FROM webhook_events event INDEXED BY webhook_events_retention_idx
			  WHERE event.created_at < ?
			  AND NOT EXISTS (SELECT 1 FROM webhook_deliveries delivery WHERE delivery.event_id = event.id)
			  LIMIT 1)
			 OR EXISTS(SELECT 1 FROM payment_test_runs run INDEXED BY payment_test_runs_retention_idx
			  WHERE run.completed_at < ? AND run.status IN ('passed', 'failed', 'cancelled', 'expired')
			  LIMIT 1)
			) AS due`,
		)
		.bind(now, cutoff, cutoff, cutoff, cutoff, testEvidenceCutoff)
		.first<{ due: number }>();
	return row?.due === 1;
}

export async function runOperationalRetentionCleanup(input: {
	db: D1Database;
	bucket: Pick<R2Bucket, "delete">;
	now: number;
	retentionMs: number;
	testEvidenceRetentionMs?: number;
	maxRows?: number;
	maxDurationMs?: number;
}) {
	const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
	const deadline =
		performance.now() + (input.maxDurationMs ?? DEFAULT_MAX_DURATION_MS);
	const cutoff = input.now - input.retentionMs;
	const testEvidenceCutoff =
		input.now - (input.testEvidenceRetentionMs ?? input.retentionMs);
	let affectedRows = 0;
	let testEvidenceRows = 0;
	let webhookRows = 0;

	while (affectedRows < maxRows && performance.now() < deadline) {
		const remaining = Math.min(CLEANUP_BATCH_SIZE, maxRows - affectedRows);
		const receipts = await deletePaymentTestReceipts(
			input.db,
			testEvidenceCutoff,
			remaining,
		);
		affectedRows += receipts;
		testEvidenceRows += receipts;
		if (affectedRows >= maxRows || performance.now() >= deadline) break;
		const runs = await deletePaymentTestRuns(
			input.db,
			testEvidenceCutoff,
			Math.min(CLEANUP_BATCH_SIZE, maxRows - affectedRows),
		);
		affectedRows += runs;
		testEvidenceRows += runs;
		if (receipts + runs === 0) break;
	}

	while (affectedRows < maxRows && performance.now() < deadline) {
		const before = affectedRows;
		const attempts = await deleteWebhookAttempts(
			input.db,
			cutoff,
			Math.min(CLEANUP_BATCH_SIZE, maxRows - affectedRows),
		);
		affectedRows += attempts;
		webhookRows += attempts;
		if (affectedRows >= maxRows || performance.now() >= deadline) break;
		const deliveries = await deleteWebhookDeliveries(
			input.db,
			cutoff,
			Math.min(CLEANUP_BATCH_SIZE, maxRows - affectedRows),
		);
		affectedRows += deliveries;
		webhookRows += deliveries;
		if (affectedRows >= maxRows || performance.now() >= deadline) break;
		const events = await deleteWebhookEvents(
			input.db,
			cutoff,
			Math.min(CLEANUP_BATCH_SIZE, maxRows - affectedRows),
		);
		affectedRows += events;
		webhookRows += events;
		if (affectedRows === before) break;
	}

	const auditExports = await deleteExpiredAuditExports(
		input.db,
		input.bucket,
		input.now,
		Math.min(AUDIT_EXPORT_BATCH_SIZE, Math.max(0, maxRows - affectedRows)),
	);
	return {
		affectedRows: affectedRows + auditExports,
		webhookRows,
		auditExports,
		testEvidenceRows,
	};
}

async function deletePaymentTestReceipts(
	db: D1Database,
	cutoff: number,
	limit: number,
) {
	if (limit === 0) return 0;
	const result = await db
		.prepare(
			`DELETE FROM payment_test_callback_receipts WHERE id IN (
			 SELECT receipt.id FROM payment_test_callback_receipts receipt
			 JOIN payment_test_runs run ON run.id = receipt.run_id
			 WHERE run.status IN ('passed', 'failed', 'cancelled', 'expired')
			 AND run.completed_at < ? ORDER BY receipt.received_at, receipt.id LIMIT ?
			)`,
		)
		.bind(cutoff, limit)
		.run();
	return result.meta.changes ?? 0;
}

async function deletePaymentTestRuns(
	db: D1Database,
	cutoff: number,
	limit: number,
) {
	if (limit === 0) return 0;
	const result = await db
		.prepare(
			`DELETE FROM payment_test_runs WHERE id IN (
			 SELECT run.id FROM payment_test_runs run INDEXED BY payment_test_runs_retention_idx
			 WHERE run.completed_at < ?
			 AND run.status IN ('passed', 'failed', 'cancelled', 'expired')
			 AND NOT EXISTS (
			  SELECT 1 FROM payment_test_callback_receipts receipt WHERE receipt.run_id = run.id
			 ) ORDER BY run.completed_at, run.id LIMIT ?
			)`,
		)
		.bind(cutoff, limit)
		.run();
	return result.meta.changes ?? 0;
}

async function deleteWebhookAttempts(
	db: D1Database,
	cutoff: number,
	limit: number,
) {
	if (limit === 0) return 0;
	const result = await db
		.prepare(
			`DELETE FROM webhook_attempts WHERE id IN (
			 SELECT attempt.id FROM webhook_attempts attempt INDEXED BY webhook_attempts_retention_idx
			 JOIN webhook_deliveries delivery ON delivery.id = attempt.delivery_id
			 WHERE attempt.attempted_at < ? AND delivery.status IN ('succeeded', 'dead')
			 AND delivery.completed_at < ?
			 ORDER BY attempt.attempted_at, attempt.id LIMIT ?
			)`,
		)
		.bind(cutoff, cutoff, limit)
		.run();
	return result.meta.changes ?? 0;
}

async function deleteWebhookDeliveries(
	db: D1Database,
	cutoff: number,
	limit: number,
) {
	if (limit === 0) return 0;
	const result = await db
		.prepare(
			`DELETE FROM webhook_deliveries WHERE id IN (
			 SELECT delivery.id FROM webhook_deliveries delivery
			 INDEXED BY webhook_deliveries_retention_idx
			 WHERE delivery.status IN ('succeeded', 'dead') AND delivery.completed_at < ?
			 AND NOT EXISTS (SELECT 1 FROM webhook_attempts attempt WHERE attempt.delivery_id = delivery.id)
			 ORDER BY delivery.completed_at, delivery.id LIMIT ?
			)`,
		)
		.bind(cutoff, limit)
		.run();
	return result.meta.changes ?? 0;
}

async function deleteWebhookEvents(
	db: D1Database,
	cutoff: number,
	limit: number,
) {
	if (limit === 0) return 0;
	const result = await db
		.prepare(
			`DELETE FROM webhook_events WHERE id IN (
			 SELECT event.id FROM webhook_events event INDEXED BY webhook_events_retention_idx
			 WHERE event.created_at < ?
			 AND NOT EXISTS (SELECT 1 FROM webhook_deliveries delivery WHERE delivery.event_id = event.id)
			 ORDER BY event.created_at, event.id LIMIT ?
			)`,
		)
		.bind(cutoff, limit)
		.run();
	return result.meta.changes ?? 0;
}

async function deleteExpiredAuditExports(
	db: D1Database,
	bucket: Pick<R2Bucket, "delete">,
	now: number,
	limit: number,
) {
	if (limit === 0) return 0;
	const due = await db
		.prepare(
			`SELECT id, object_key FROM audit_exports INDEXED BY audit_exports_retention_idx
			 WHERE delete_after <= ? AND deleted_at IS NULL
			 ORDER BY delete_after, id LIMIT ?`,
		)
		.bind(now, limit)
		.all<{ id: string; object_key: string }>();
	if (due.results.length === 0) return 0;

	// R2 deletion must succeed before D1 records the object as intentionally gone.
	await bucket.delete(due.results.map((row) => row.object_key));
	const updates = await db.batch(
		due.results.map((row) =>
			db
				.prepare(
					"UPDATE audit_exports SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
				)
				.bind(now, now, row.id),
		),
	);
	return updates.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
}
