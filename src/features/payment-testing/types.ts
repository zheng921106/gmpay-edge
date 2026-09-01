export const paymentNetworkClasses = [
	"mainnet",
	"testnet",
	"simulated",
] as const;
export const paymentEnvironmentCodes = ["sandbox", "production"] as const;

export const paymentTestProtocols = ["gmpay", "epay"] as const;
export const paymentTestModes = ["simulator", "testnet", "live"] as const;
export const paymentTestStatuses = [
	"ready",
	"running",
	"passed",
	"failed",
	"cancelled",
	"expired",
] as const;
export const paymentTestCallbackModes = ["builtin", "custom"] as const;
export const paymentTestExpectedOutcomes = [
	"paid",
	"partial",
	"overpaid",
	"failed_payment",
	"late_payment",
	"reorg_recovered",
	"callback_retry_succeeded",
] as const;

export type PaymentNetworkClass = (typeof paymentNetworkClasses)[number];
export type PaymentEnvironmentCode = (typeof paymentEnvironmentCodes)[number];
export type PaymentTestProtocol = (typeof paymentTestProtocols)[number];
export type PaymentTestMode = (typeof paymentTestModes)[number];
export type PaymentTestStatus = (typeof paymentTestStatuses)[number];
export type PaymentTestCallbackMode = (typeof paymentTestCallbackModes)[number];
export type PaymentTestExpectedOutcome =
	(typeof paymentTestExpectedOutcomes)[number];

export type RedactedProtocolSnapshot = {
	version: 1;
	method: "GET" | "POST";
	path: string;
	headers: Record<string, string>;
	body: Record<string, unknown> | null;
	status?: number;
	durationMs?: number;
};
