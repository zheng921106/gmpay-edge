import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EnvironmentBoundary } from "#/features/payment-testing/components/environment-boundary";
import { RunTimeline } from "#/features/payment-testing/components/run-timeline";
import {
	defaultPaymentTestValues,
	scenarioSteps,
} from "#/features/payment-testing/pages/guided-test";

describe("payment test center pages", () => {
	it("defaults a sandbox workspace to the simulator and built-in callback", () => {
		expect(
			defaultPaymentTestValues(
				{
					apiKeys: [{ id: "key-1", name: "Sandbox", pid: "pid" }],
					receivingMethods: [
						{
							id: "method-1",
							name: "Simulator",
							railCode: "simulator",
							railName: "Simulator",
							networkClass: "simulated",
							assetId: "simulator-usdt",
							assetCode: "USDT",
						},
					],
				},
				"sandbox",
			),
		).toMatchObject({
			protocol: "gmpay",
			paymentMode: "simulator",
			apiKeyId: "key-1",
			receivingMethodId: "method-1",
			paymentAssetId: "simulator-usdt",
			callbackMode: "builtin",
		});
	});

	it("marks production as real funds and omits simulator controls", () => {
		const markup = renderToStaticMarkup(
			<EnvironmentBoundary
				environment="production"
				merchantId="merchant-1"
				environmentId="production-1"
			/>,
		);
		expect(markup).toContain('data-environment="production"');
		expect(markup).toContain('data-real-funds="true"');
		expect(markup).not.toContain('data-simulator-control="true"');
	});

	it("renders chronological evidence with semantic event markers", () => {
		const markup = renderToStaticMarkup(
			<RunTimeline
				events={[
					{
						id: "run:1",
						kind: "run.created",
						occurredAt: 1,
						priority: 10,
						status: "running",
						detail: null,
					},
					{
						id: "callback:1",
						kind: "callback.received",
						occurredAt: 2,
						priority: 70,
						status: "valid",
						detail: { attempt: 1 },
					},
				]}
			/>,
		);
		expect(markup).toContain('data-event-kind="run.created"');
		expect(markup).toContain('data-event-kind="callback.received"');
		expect(markup.indexOf("run.created")).toBeLessThan(
			markup.indexOf("callback.received"),
		);
		expect(markup).not.toMatch(/secret|authorization|cookie/i);
	});

	it("defines bounded steps for every simulator scenario", () => {
		expect(scenarioSteps.partial_then_complete).toBe(2);
		expect(scenarioSteps.reorg_then_recover).toBe(3);
		expect(scenarioSteps.exact_success).toBe(1);
	});
});
