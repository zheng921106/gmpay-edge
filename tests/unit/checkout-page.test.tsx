// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteBrandProvider } from "#/context/site-brand-provider";
import { ThemeProvider } from "#/context/theme-provider";
import type { CheckoutOrder } from "#/features/checkout/checkout-model";
import { CheckoutPage } from "#/features/checkout/pages/checkout";
import type { SiteBrand } from "#/features/settings/site-brand";

const brand: SiteBrand = {
	name: "TOGETHER9",
	logoUrl: "/favicon.png",
	title: "TOGETHER9",
	supportUrl: "",
	backgroundColor: "",
	backgroundImageUrl: "",
	defaultLocale: "en-US",
};

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("checkout page", () => {
	let container: HTMLDivElement | undefined;
	let root: ReactRoot | undefined;

	afterEach(async () => {
		if (root) await act(async () => root?.unmount());
		container?.remove();
		container = undefined;
		root = undefined;
		vi.unstubAllGlobals();
	});

	it("does not present a missing order as awaiting confirmation", async () => {
		const rootRoute = createRootRoute({ component: Root });
		const checkoutRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/checkout/$orderId",
			component: Checkout,
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: ["/checkout/97195835464881897971"],
			}),
			routeTree: rootRoute.addChildren([checkoutRoute]),
		});
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		await router.load();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		vi.stubGlobal("scrollTo", () => undefined);

		await act(async () => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>,
			);
		});

		expect(container.textContent).toContain("Order Not Found");
		expect(container.textContent).not.toContain("Waiting for confirmation");
	});

	it("uses theme-aware surfaces and identifies the order merchant", async () => {
		const order: CheckoutOrder = {
			trade_id: "27163834908132114257",
			external_order_id: "merchant-order-1",
			merchant_name: "Merchant North",
			environment: "sandbox",
			amount: "12.5",
			actual_amount: "12.5",
			currency: "USD",
			token: "USDT",
			network: "tron",
			receive_address: "THchhnWApQSqEdLk6D9Xfa7pY8gKmeoQGE",
			expiration_time: new Date(Date.UTC(2026, 7, 29) + 900_000).toISOString(),
			status_detail: "pending",
		};
		const rootRoute = createRootRoute({ component: Root });
		const checkoutRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/checkout/$orderId",
			component: () => (
				<ThemeProvider>
					<SiteBrandProvider brand={brand}>
						<CheckoutPage
							initialNow={Date.UTC(2026, 7, 29)}
							initialOrder={order}
							orderId={order.trade_id}
						/>
					</SiteBrandProvider>
				</ThemeProvider>
			),
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: [`/checkout/${order.trade_id}`],
			}),
			routeTree: rootRoute.addChildren([checkoutRoute]),
		});
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		await router.load();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		vi.stubGlobal("scrollTo", () => undefined);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);

		await act(async () => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>,
			);
		});

		const checkoutSurface = container.querySelector("main");
		expect(checkoutSurface?.className).toContain("bg-background");
		expect(checkoutSurface?.className).toContain("text-foreground");
		expect(container.textContent).toContain("Payment to Merchant North");
		expect(container.textContent).toContain("Sandbox");
		expect(
			container.querySelector(
				'a[href="https://github.com/GMwalletApp/gmpay-edge"]',
			),
		).toBeNull();
		expect(container.textContent).not.toContain("Open source");
	});
});

function Root() {
	return <Outlet />;
}

function Checkout() {
	return (
		<ThemeProvider>
			<SiteBrandProvider brand={brand}>
				<CheckoutPage
					initialNow={Date.UTC(2026, 7, 29)}
					initialOrder={null}
					orderId="97195835464881897971"
				/>
			</SiteBrandProvider>
		</ThemeProvider>
	);
}
