import type { SimulatorScenario } from "#/features/payment-testing/server/simulator";
import type {
	PaymentTestCallbackMode,
	PaymentTestMode,
} from "#/features/payment-testing/types";
import { m } from "#/paraglide/messages";

export function paymentTestModeLabel(mode: PaymentTestMode) {
	if (mode === "live") return m.payment_test_mode_live();
	if (mode === "testnet") return m.payment_test_mode_testnet();
	return m.payment_test_mode_simulator();
}

export function paymentTestCallbackModeLabel(mode: PaymentTestCallbackMode) {
	return mode === "builtin"
		? m.payment_test_callback_builtin()
		: m.payment_test_callback_custom();
}

export function simulatorScenarioLabel(scenario: SimulatorScenario) {
	const labels = {
		exact_success: m.payment_test_scenario_exact_success(),
		partial_then_complete: m.payment_test_scenario_partial_then_complete(),
		overpayment: m.payment_test_scenario_overpayment(),
		confirmation_progression:
			m.payment_test_scenario_confirmation_progression(),
		failed_transaction: m.payment_test_scenario_failed_transaction(),
		duplicate_delivery: m.payment_test_scenario_duplicate_delivery(),
		late_payment: m.payment_test_scenario_late_payment(),
		reorg_then_recover: m.payment_test_scenario_reorg_then_recover(),
		callback_failure_then_retry:
			m.payment_test_scenario_callback_failure_then_retry(),
	} satisfies Record<SimulatorScenario, string>;
	return labels[scenario];
}
