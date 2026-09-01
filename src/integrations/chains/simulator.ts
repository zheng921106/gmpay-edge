import { z } from "zod";
import type {
	AdapterErrorKind,
	NormalizedTransaction,
	PaymentAdapter,
	PaymentTarget,
} from "./types";

const configSchema = z.object({});
export type SimulatorConfig = z.infer<typeof configSchema>;

export function createSimulatorTransaction(input: {
	hash: string;
	blockHash: string;
	from: string;
	to: string;
	assetCode: string;
	amountUnits: bigint;
	blockNumber: bigint;
	confirmations: number;
	timestamp: Date;
	success: boolean;
	canonical?: boolean;
}): NormalizedTransaction {
	return {
		network: "simulator",
		eventIndex: 0,
		...input,
	};
}

export class SimulatorAdapter implements PaymentAdapter<SimulatorConfig> {
	readonly id = "simulator";
	readonly network = "simulator" as const;
	readonly configSchema = configSchema;

	validateConfig(value: unknown): SimulatorConfig {
		return this.configSchema.parse(value ?? {});
	}

	async createPaymentTarget(input: { address: string; expiresAt: Date }) {
		if (!this.validateAddress(input.address))
			throw new Error("Invalid simulator address");
		return input;
	}

	async getTransaction() {
		return null;
	}

	async findTransactions(_input: {
		address: string;
		assetCode: string;
		sinceBlock?: bigint;
	}) {
		return [];
	}

	validateAddress(address: string) {
		return /^sim_[a-z0-9]{8,64}$/.test(address);
	}

	validatePayment(
		transaction: NormalizedTransaction,
		target: PaymentTarget,
		assetCode: string,
	) {
		return (
			transaction.success &&
			transaction.canonical !== false &&
			transaction.network === this.network &&
			transaction.to === target.address &&
			transaction.assetCode.toUpperCase() === assetCode.toUpperCase()
		);
	}

	async getConfirmations(transaction: NormalizedTransaction) {
		return transaction.confirmations;
	}

	async healthCheck() {
		return { healthy: true, latencyMs: 0, checkedAt: new Date() };
	}

	classifyError(): AdapterErrorKind {
		return "permanent";
	}

	isRetryable() {
		return false;
	}
}
