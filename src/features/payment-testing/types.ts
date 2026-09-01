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
export const simulatorScenarios = [
	"exact_success",
	"partial_then_complete",
	"overpayment",
	"confirmation_progression",
	"failed_transaction",
	"duplicate_delivery",
	"late_payment",
	"reorg_then_recover",
	"callback_failure_then_retry",
] as const;

export const simulatorScenarioSteps = {
	exact_success: 1,
	partial_then_complete: 2,
	overpayment: 1,
	confirmation_progression: 2,
	failed_transaction: 1,
	duplicate_delivery: 1,
	late_payment: 1,
	reorg_then_recover: 3,
	callback_failure_then_retry: 1,
} as const satisfies Record<(typeof simulatorScenarios)[number], number>;

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

export type MerchantAccessContext = {
	userId: string;
	merchantId: string;
	environmentId: string;
	environment: PaymentEnvironmentCode;
	requestOrigin: string;
};

export type PaymentTestRuntime = {
	DB: D1Database;
	WEBHOOK_QUEUE?: unknown;
	PAYMENT_QUEUE?: unknown;
};

export type PaymentTestPreflight = {
	ready: true;
	environment: PaymentEnvironmentCode;
	apiKey: { id: string; pid: string; secretEncrypted: string };
	receivingMethod: { id: string; targetValue: string };
	asset: { id: string; code: string; decimals: number };
	rail: { code: string; networkClass: PaymentNetworkClass };
};

export type PaymentTestStartResult = {
	runId: string;
	orderId: string | null;
	status: PaymentTestStatus;
	confirmationRequired: boolean;
	confirmationToken?: string;
};
