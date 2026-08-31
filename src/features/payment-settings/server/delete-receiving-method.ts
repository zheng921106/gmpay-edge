import type { MerchantEnvironmentContext } from "#/db/schema";
import { paymentSettingsError } from "#/features/payment-settings/errors";

export async function deleteReceivingMethod(
	db: D1Database,
	id: string,
	audit: {
		actorUserId: string | null;
		requestId: string | null;
		ipAddress: string | null;
	},
	scope?: MerchantEnvironmentContext,
) {
	const scopeSql = scope ? " AND merchant_id IS ? AND environment_id IS ?" : "";
	const scopeBindings = scope ? [scope.merchantId, scope.environmentId] : [];
	const current = await db
		.prepare(
			`SELECT name, rail_code,
			 (SELECT COUNT(*) FROM order_payment_snapshots WHERE receiving_method_id = receiving_methods.id) +
			 (SELECT COUNT(*) FROM receiving_method_locks WHERE receiving_method_id = receiving_methods.id) AS reference_count
			 FROM receiving_methods WHERE id = ?${scopeSql} LIMIT 1`,
		)
		.bind(id, ...scopeBindings)
		.first<{ name: string; rail_code: string; reference_count: number }>();
	if (!current) throw paymentSettingsError("receiving_method_not_found");
	if (current.reference_count > 0)
		return { id, deleted: false as const, reason: "in_use" as const };
	const now = Date.now();
	const results = await db.batch([
		db
			.prepare(
				`DELETE FROM receiving_methods WHERE id = ?${scopeSql}
				 AND NOT EXISTS (SELECT 1 FROM order_payment_snapshots WHERE receiving_method_id = ?)
				 AND NOT EXISTS (SELECT 1 FROM receiving_method_locks WHERE receiving_method_id = ?)`,
			)
			.bind(id, ...scopeBindings, id, id),
		db
			.prepare(
				`INSERT INTO audit_logs
				 (id, actor_user_id, action, target_type, target_id, request_id,
				  ip_address, before, created_at)
				 SELECT ?, ?, 'receiving_method.deleted', 'receiving_method', ?, ?, ?, ?, ?
				 WHERE changes() = 1`,
			)
			.bind(
				crypto.randomUUID(),
				audit.actorUserId,
				id,
				audit.requestId,
				audit.ipAddress,
				JSON.stringify({ name: current.name, railCode: current.rail_code }),
				now,
			),
		db
			.prepare(
				`UPDATE payment_ingresses SET reconcile_required_at = ?, updated_at = ?
				 WHERE enabled = 1 AND network = ?
				 ${scope ? "AND merchant_id IS ? AND environment_id IS ?" : ""}
				 AND NOT EXISTS (SELECT 1 FROM receiving_methods WHERE id = ?)`,
			)
			.bind(now, now, current.rail_code, ...scopeBindings, id),
	]);
	// D1 can include cascading link deletions in the mutation change count.
	const deleted = (results[0]?.meta.changes ?? 0) > 0;
	return { id, deleted, reason: deleted ? null : ("in_use" as const) };
}
