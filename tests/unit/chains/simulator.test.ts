import { describe, expect, it, vi } from "vitest";
import { SimulatorAdapter } from "#/integrations/chains/simulator";

describe("simulator payment adapter", () => {
	it("validates simulator targets without network access", async () => {
		const fetcher = vi.spyOn(globalThis, "fetch");
		const adapter = new SimulatorAdapter();
		const expiresAt = new Date("2026-09-01T00:00:00.000Z");

		await expect(
			adapter.createPaymentTarget({
				address: "sim_defaultmerchant",
				expiresAt,
			}),
		).resolves.toEqual({ address: "sim_defaultmerchant", expiresAt });
		await expect(
			adapter.findTransactions({
				address: "sim_defaultmerchant",
				assetCode: "USDT",
			}),
		).resolves.toEqual([]);
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			healthy: true,
		});
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("matches only successful canonical simulator observations", () => {
		const adapter = new SimulatorAdapter();
		const target = {
			address: "sim_defaultmerchant",
			expiresAt: new Date("2026-09-01T00:00:00.000Z"),
		};
		const transaction = {
			network: "simulator" as const,
			hash: "simulated-hash",
			eventIndex: 0,
			from: "sim_sender",
			to: target.address,
			assetCode: "USDT",
			amountUnits: 1_000_000n,
			blockNumber: 1n,
			blockHash: "simulated-block",
			confirmations: 1,
			timestamp: new Date("2026-09-01T00:00:00.000Z"),
			success: true,
			canonical: true,
		};

		expect(adapter.validatePayment(transaction, target, "USDT")).toBe(true);
		expect(
			adapter.validatePayment(
				{ ...transaction, canonical: false },
				target,
				"USDT",
			),
		).toBe(false);
	});
});
