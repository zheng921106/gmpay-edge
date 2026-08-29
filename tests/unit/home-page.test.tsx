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
import { HomePage } from "#/features/home";
import type { SiteBrand } from "#/features/settings/site-brand";

const brand: SiteBrand = {
	name: "TOGETHER9",
	logoUrl: "/api/site-logo",
	title: "TOGETHER9",
	supportUrl: "",
	backgroundColor: "",
	backgroundImageUrl: "",
	defaultLocale: "en-US",
};

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("home page", () => {
	let container: HTMLDivElement | undefined;
	let root: ReactRoot | undefined;

	afterEach(async () => {
		if (root) await act(async () => root?.unmount());
		root = undefined;
		container?.remove();
		container = undefined;
		vi.unstubAllGlobals();
	});

	it("presents a payment signal visual with direct merchant entry points", async () => {
		const rootRoute = createRootRoute({ component: Root });
		const indexRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: Home,
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

		expect(
			container.querySelector('[aria-label="Live payment signal"]'),
		).not.toBeNull();
		expect(
			container.querySelector('a[href="/sign-in"]')?.textContent,
		).toContain("Start accepting");
		expect(container.querySelector('a[href="/docs"]')?.textContent).toContain(
			"View integration",
		);
	});
});

function Root() {
	return <Outlet />;
}

function Home() {
	return (
		<SiteBrandProvider brand={brand}>
			<HomePage />
		</SiteBrandProvider>
	);
}
