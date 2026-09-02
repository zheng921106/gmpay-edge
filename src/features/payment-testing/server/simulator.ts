import type { OrderStatus } from "#/features/orders/schema";
import { assertPaymentModeAllowed } from "#/features/payment-testing/environment";
import {
	type MerchantAccessContext,
	simulatorScenarioSteps,
	simulatorScenarios,
} from "#/features/payment-testing/types";
import { expireOrder } from "#/features/payments/server/expiration";
import type { PaymentRuntime } from "#/features/payments/server/payment-events";
import { recordPaymentTransaction } from "#/features/payments/server/process";
import { createSimulatorTransaction } from "#/integrations/chains/simulator";
import type { NormalizedTransaction } from "#/integrations/chains/types";
import { DomainError } from "#/lib/domain-error";
import { unitsToDecimal } from "#/lib/money";
import { minorToDecimal } from "#/lib/units";

export { simulatorScenarios } from "#/features/payment-testing/types";

export type SimulatorScenario = (typeof simulatorScenarios)[number];

type SimulatorRunRow = {
	order_id: string;
	run_status: string;
	payment_mode: "simulator" | "testnet" | "live";
	scenario: string | null;
	scenario_step: number;
	started_at: number | null;
	created_at: number;
	expires_at: number;
	environment_code: "sandbox" | "production";
	external_order_id: string;
	order_status: OrderStatus;
	amount_minor: string;
	currency: string;
	currency_decimals: number;
	received_amount_units: string;
	version: number;
	expected_amount_units: string;
	asset_code: string;
	decimals: number;
	target_value: string;
	required_confirmations: number;
	rail_code: string;
	network_class: "simulated" | "testnet" | "mainnet";
	adapter: string;
};

export async function advanceSimulatorScenario(
	env: PaymentRuntime,
	context: MerchantAccessContext,
	input: { runId: string; scenario: SimulatorScenario; step: number },
): Promise<{ runId: string; orderStatus: OrderStatus; duplicate: boolean }> {
	if (!simulatorScenarios.includes(input.scenario)) throw invalidScenarioStep();
	const row = await loadSimulatorRun(env.DB, context, input.runId);
	if (!row)
		throw new DomainError(
			"payment_test_run_not_found",
			404,
			"Payment test run was not found.",
		);
	assertPaymentModeAllowed(
		row.environment_code,
		row.payment_mode,
		row.network_class,
	);
	if (
		row.run_status !== "running" ||
		row.payment_mode !== "simulator" ||
		row.rail_code !== "simulator" ||
		row.network_class !== "simulated" ||
		row.adapter !== "simulator"
	)
		throw new DomainError(
			"payment_test_simulator_unavailable",
			409,
			"This payment test run cannot use the simulator.",
		);
	assertScenarioStep(row, input.scenario, input.step);

	if (input.scenario === "late_payment" && row.order_status !== "expired")
		await expireSimulatorOrder(env, row);
	const transaction = await scenarioTransaction(row, input);
	const payment = await recordPaymentTransaction(
		env,
		row.order_id,
		transaction,
	);
	const now = Date.now();
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE payment_test_runs SET scenario = ?, scenario_step = ?, updated_at = ?
			 WHERE id = ? AND merchant_id = ? AND environment_id = ?
			 AND (scenario IS NULL OR scenario = ?) AND scenario_step <= ?`,
		).bind(
			input.scenario,
			input.step,
			now,
			input.runId,
			context.merchantId,
			context.environmentId,
			input.scenario,
			input.step,
		),
		env.DB.prepare(
			`INSERT INTO audit_logs
			 (id, actor_user_id, action, target_type, target_id, after, created_at)
			 VALUES (?, ?, 'payment_test.scenario_advanced', 'payment_test_run', ?, ?, ?)`,
		).bind(
			crypto.randomUUID(),
			context.userId,
			input.runId,
			JSON.stringify({
				scenario: input.scenario,
				step: input.step,
				orderStatus: payment.status,
				duplicate: payment.duplicate,
			}),
			now,
		),
	]);
	return {
		runId: input.runId,
		orderStatus: payment.status,
		duplicate: payment.duplicate,
	};
}

async function loadSimulatorRun(
	db: D1Database,
	context: MerchantAccessContext,
	runId: string,
) {
	return db
		.prepare(
			`SELECT run.order_id, run.status AS run_status, run.payment_mode,
			 run.scenario, run.scenario_step, run.started_at, run.created_at,
			 order_record.expires_at,
			 environment.code AS environment_code,
			 order_record.external_order_id, order_record.status AS order_status,
			 order_record.amount_minor, order_record.currency,
			 order_record.currency_decimals, order_record.received_amount_units,
			 order_record.version, snapshot.expected_amount_units,
			 snapshot.asset_code, snapshot.decimals, snapshot.target_value,
			 snapshot.required_confirmations, snapshot.rail_code,
			 rail.network_class, snapshot.adapter
			 FROM payment_test_runs run
			 JOIN merchant_environments environment ON environment.id = run.environment_id
			 JOIN orders order_record ON order_record.id = run.order_id
			  AND order_record.merchant_id = run.merchant_id
			  AND order_record.environment_id = run.environment_id
			 JOIN order_payment_snapshots snapshot ON snapshot.order_id = order_record.id
			 JOIN payment_rails rail ON rail.code = snapshot.rail_code
			 WHERE run.id = ? AND run.merchant_id = ? AND run.environment_id = ?
			 LIMIT 1`,
		)
		.bind(runId, context.merchantId, context.environmentId)
		.first<SimulatorRunRow>();
}

function assertScenarioStep(
	row: Pick<SimulatorRunRow, "scenario" | "scenario_step">,
	scenario: SimulatorScenario,
	step: number,
) {
	if (row.scenario !== null && row.scenario !== scenario)
		throw new DomainError(
			"payment_test_scenario_conflict",
			409,
			"The payment test run is already using another scenario.",
		);
	const isNext = step === row.scenario_step + 1;
	const isReplay = row.scenario === scenario && step === row.scenario_step;
	if (
		!Number.isInteger(step) ||
		step < 1 ||
		step > simulatorScenarioSteps[scenario] ||
		(!isNext && !isReplay)
	)
		throw invalidScenarioStep();
}

function invalidScenarioStep() {
	return new DomainError(
		"payment_test_scenario_step_invalid",
		409,
		"The simulator scenario step is invalid.",
	);
}

async function expireSimulatorOrder(env: PaymentRuntime, row: SimulatorRunRow) {
	if (
		row.order_status !== "pending" &&
		row.order_status !== "confirming" &&
		row.order_status !== "partially_paid"
	)
		throw invalidScenarioStep();
	await expireOrder(
		env,
		{
			id: row.order_id,
			external_order_id: row.external_order_id,
			status: row.order_status,
			amount: minorToDecimal(row.amount_minor, row.currency_decimals),
			currency: row.currency,
			paymentAmount: unitsToDecimal(
				BigInt(row.expected_amount_units),
				row.decimals,
			),
			received_amount_units: row.received_amount_units,
			code: row.asset_code,
			network: row.rail_code,
			version: row.version,
		},
		Date.now(),
	);
}

async function scenarioTransaction(
	row: SimulatorRunRow,
	input: { runId: string; scenario: SimulatorScenario; step: number },
): Promise<NormalizedTransaction> {
	const expected = BigInt(row.expected_amount_units);
	const partial = expected / 2n;
	const transactionIndex =
		input.scenario === "partial_then_complete" ? input.step : 1;
	const hash = await deterministicHex(
		`${input.runId}:${input.scenario}:${transactionIndex}`,
	);
	const canonical = !(
		input.scenario === "reorg_then_recover" && input.step === 2
	);
	const confirmations =
		input.scenario === "confirmation_progression" && input.step === 1
			? Math.max(0, row.required_confirmations - 1)
			: canonical
				? row.required_confirmations
				: 0;
	const amountUnits =
		input.scenario === "partial_then_complete"
			? input.step === 1
				? partial
				: expected - partial
			: input.scenario === "overpayment"
				? expected + (expected / 10n > 0n ? expected / 10n : 1n)
				: expected;
	const blockHash = await deterministicHex(
		`${input.runId}:${input.scenario}:block:${input.step}:${canonical}`,
	);
	return createSimulatorTransaction({
		hash: `sim_${hash}`,
		blockHash: `sim_${blockHash}`,
		from: `sim_payer${hash.slice(0, 24)}`,
		to: row.target_value,
		assetCode: row.asset_code,
		amountUnits,
		blockNumber: BigInt(input.step),
		confirmations,
		timestamp: new Date(
			input.scenario === "late_payment"
				? row.expires_at + input.step
				: (row.started_at ?? row.created_at) + input.step,
		),
		success: input.scenario !== "failed_transaction",
		canonical,
	});
}

async function deterministicHex(value: string) {
	const bytes = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
