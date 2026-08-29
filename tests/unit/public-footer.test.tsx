// @vitest-environment jsdom

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
import type { SiteBrand } from "#/features/settings/site-brand";
import { PublicFooter } from "#/layouts/public/footer";

const brand: SiteBrand = {
	name: "GMPay Edge",
	logoUrl: "/api/site-logo",
	title: "GMPay Edge",
	supportUrl: "",
	backgroundColor: "",
	backgroundImageUrl: "",
	defaultLocale: "en-US",
};

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("public footer", () => {
	let container: HTMLDivElement | undefined;
	let root: ReactRoot | undefined;

	afterEach(async () => {
		if (root) await act(async () => root?.unmount());
		root = undefined;
		container?.remove();
		container = undefined;
		vi.unstubAllGlobals();
	});

	it("does not render the Cloudflare platform or payment infrastructure copy", async () => {
		const rootRoute = createRootRoute({ component: Root });
		const indexRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: FooterPage,
		});
		const router = createRouter({
			history: createMemoryHistory({ initialEntries: ["/"] }),
			routeTree: rootRoute.addChildren([indexRoute]),
		});

		await router.load();
		container = document.createElement("div");
		document.body.appendChild(container);
		vi.stubGlobal("scrollTo", () => undefined);
		const mountedRoot = createRoot(container);
		root = mountedRoot;
		await act(async () =>
			mountedRoot.render(<RouterProvider router={router} />),
		);

		expect(container.textContent).not.toContain("Cloudflare Edge");
		expect(container.textContent).not.toContain(
			"Multi-chain payment infrastructure running close to customers on the Cloudflare edge",
		);
	});
});

function Root() {
	return <Outlet />;
}

function FooterPage() {
	return (
		<SiteBrandProvider brand={brand}>
			<PublicFooter />
		</SiteBrandProvider>
	);
}
