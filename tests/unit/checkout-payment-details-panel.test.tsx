// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentDetailsPanel } from "#/features/checkout/components/payment-details-panel";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("checkout payment details", () => {
	let container: HTMLDivElement | undefined;
	let root: Root | undefined;

	afterEach(async () => {
		if (root) await act(async () => root?.unmount());
		container?.remove();
		container = undefined;
		root = undefined;
	});

	it("announces its active payment instructions and countdown", async () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);

		await act(async () => {
			root?.render(
				<PaymentDetailsPanel
					onChangePaymentOption={() => undefined}
					onCopyAddress={() => true}
					onReviewSubmitted={() => undefined}
					onSubmitTxHash={async () => true}
					onTxHashChange={() => undefined}
					order={{
						amount: "12.5001",
						receive_address: "THchhnWApQSqEdLk6D9Xfa7pY8gKmeoQGE",
						token: "USDT",
						trade_id: "97195835464881897971",
					}}
					orderId="97195835464881897971"
					paymentFlow="chain"
					remaining={752}
					showChangePaymentOption={false}
					showReviewSubmit={false}
					showTxHashSubmit={false}
					submittingTxHash={false}
					timeColor="#b6ff43"
					timerRatio={0.84}
					txHash=""
				/>,
			);
		});

		const paymentInstructions = container.querySelector(
			'[aria-label="Scan or copy address to pay"]',
		);
		expect(paymentInstructions).not.toBeNull();
		expect(
			paymentInstructions?.querySelector('[aria-live="polite"]')?.textContent,
		).toBe("12:32");
	});
});
