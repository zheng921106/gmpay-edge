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
