// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnchorHTMLAttributes } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const serverFunctions = vi.hoisted(() => ({
	advanceSimulatorScenarioFn: vi.fn(),
	cancelPaymentTestRunFn: vi.fn(),
	confirmProductionPaymentTestRunFn: vi.fn(),
	getPaymentTestResourcesFn: vi.fn(),
	getPaymentTestRunFn: vi.fn(),
	preflightPaymentTestFn: vi.fn(),
	refreshRealPaymentTestRunFn: vi.fn(),
	startPaymentTestRunFn: vi.fn(),
}));

vi.mock("#/features/payment-testing/server/functions", () => serverFunctions);

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		...props
	}: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props} />
	),
}));

import { PaymentTestComposer } from "#/features/payment-testing/pages/guided-test";
import { NavigationProvider } from "#/layouts/components/navigation-context";
import { m } from "#/paraglide/messages";

describe("payment test receiving method resources", () => {
	afterEach(() => {
		serverFunctions.getPaymentTestResourcesFn.mockReset();
	});

	it("shows a receiving-method configuration action instead of a blank selector", async () => {
		serverFunctions.getPaymentTestResourcesFn.mockResolvedValue({
			environment: "production",
			apiKeys: [{ id: "key-1", name: "Live", pid: "pid-live" }],
			receivingMethods: [],
		});
		const fixture = await renderPaymentTestComposer();

		await waitFor(() =>
			fixture.container.querySelector(
				'[data-payment-test-method-status="configuration-required"]',
			),
		);
		const action = fixture.container.querySelector<HTMLAnchorElement>(
			'[data-payment-test-method-status="configuration-required"] a[href="/admin/receiving-methods"]',
		);
		expect(action).not.toBeNull();
		expect(
			fixture.container.querySelectorAll('[role="combobox"][disabled]'),
		).toHaveLength(1);

		await fixture.unmount();
	});

	it("refreshes the receiving-method selector after a method is configured", async () => {
		serverFunctions.getPaymentTestResourcesFn
			.mockResolvedValueOnce({
				environment: "production",
				apiKeys: [{ id: "key-1", name: "Live", pid: "pid-live" }],
				receivingMethods: [],
			})
			.mockResolvedValueOnce({
				environment: "production",
				apiKeys: [{ id: "key-1", name: "Live", pid: "pid-live" }],
				receivingMethods: [
					{
						id: "method-1",
						name: "Main collection",
						railCode: "bsc",
						railName: "BNB Smart Chain",
						networkClass: "mainnet",
						assetId: "bsc-bnb",
						assetCode: "BNB",
					},
				],
			});
		const fixture = await renderPaymentTestComposer();

		await waitFor(() =>
			fixture.container.querySelector(
				'[data-payment-test-method-status="configuration-required"]',
			),
		);
		const refresh = fixture.container.querySelector<HTMLButtonElement>(
			'[data-payment-test-resources-refresh="true"]',
		);
		expect(refresh).not.toBeNull();
		await act(async () => refresh?.click());

		await waitFor(() =>
			fixture.container.textContent?.includes("BNB Smart Chain"),
		);
		expect(
			fixture.container.querySelector(
				'[data-payment-test-method-status="configuration-required"]',
			),
		).toBeNull();

		await fixture.unmount();
	});

	it("explains an invalid receiving address and links to its configuration", async () => {
		serverFunctions.getPaymentTestResourcesFn.mockResolvedValue({
			environment: "production",
			apiKeys: [{ id: "key-1", name: "Live", pid: "pid-live" }],
			receivingMethods: [
				{
					id: "method-1",
					name: "Main collection",
					railCode: "bsc",
					railName: "BNB Smart Chain",
					networkClass: "mainnet",
					assetId: "bsc-bnb",
					assetCode: "BNB",
				},
			],
		});
		serverFunctions.preflightPaymentTestFn.mockRejectedValue(
			new Error("The receiving target is invalid."),
		);
		const fixture = await renderPaymentTestComposer();

		await waitFor(() =>
			fixture.container.textContent?.includes("BNB Smart Chain"),
		);
		const readiness = [...fixture.container.querySelectorAll("button")].find(
			(button) =>
				button.textContent?.includes(m.payment_test_check_readiness()),
		);
		expect(readiness).toBeTruthy();
		await act(async () => readiness?.click());

		await waitFor(() =>
			fixture.container.querySelector(
				'[data-payment-test-method-status="invalid-target"]',
			),
		);
		expect(
			fixture.container.querySelector(
				'[data-payment-test-method-status="invalid-target"] a[href="/admin/receiving-methods"]',
			),
		).not.toBeNull();

		await fixture.unmount();
	});
});

async function renderPaymentTestComposer() {
	const container = document.createElement("div");
	const root = createRoot(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<NavigationProvider
					navigation={{ navGroups: [] }}
					permissions={[]}
					merchantContext={{
						merchantId: "merchant-1",
						environmentId: "production-1",
						environment: "production",
					}}
				>
					<PaymentTestComposer />
				</NavigationProvider>
			</QueryClientProvider>,
		);
	});
	return {
		container,
		unmount: async () => act(async () => root.unmount()),
	};
}

async function waitFor(assertion: () => unknown) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (assertion()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	expect(assertion()).toBeTruthy();
}
