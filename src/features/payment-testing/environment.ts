import type {
	PaymentEnvironmentCode,
	PaymentNetworkClass,
	PaymentTestMode,
} from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";

export function assertPaymentModeAllowed(
	environment: PaymentEnvironmentCode,
	mode: PaymentTestMode,
	networkClass: PaymentNetworkClass,
) {
	const expectedEnvironment = mode === "live" ? "production" : "sandbox";
	if (environment !== expectedEnvironment)
		throw new DomainError(
			"payment_mode_environment_mismatch",
			400,
			"The payment mode is not available in this environment.",
		);
	const expectedNetworkClass =
		mode === "live" ? "mainnet" : mode === "testnet" ? "testnet" : "simulated";
	if (networkClass !== expectedNetworkClass)
		throw new DomainError(
			"payment_rail_class_mismatch",
			400,
			"The payment rail does not support the selected mode.",
		);
}
