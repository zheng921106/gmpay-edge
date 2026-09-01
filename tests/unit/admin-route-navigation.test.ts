import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getAdminBootstrapFn: vi.fn() }));

vi.mock("#/features/auth/server/session", () => auth);
vi.mock("#/layouts/components/data/sidebar-data", () => ({
	canAccessAdminPath: () => true,
	canAccessMerchantPath: () => true,
	merchantSidebarData: () => ({ navGroups: [] }),
	systemSidebarData: () => ({ navGroups: [] }),
}));
vi.mock("#/layouts/dashboard", () => ({ DashboardLayout: () => null }));

describe("admin route navigation", () => {
	it("loads bootstrap on entry and keeps the parent match stable", async () => {
		const access = {
			id: "root-user",
			name: "Root",
			email: "root@example.com",
			enabled: true,
			updatedAt: new Date(0),
			roles: ["root"],
			root: true,
			permissions: [],
		};
		auth.getAdminBootstrapFn.mockResolvedValue({ installed: true, access });
		const { Route } = await import("#/routes/admin/route");
		const loader = Route.options.loader as (input: {
			location: { href: string; pathname: string };
		}) => Promise<{ systemAccess: typeof access; user: typeof access }>;

		await expect(
			loader({
				location: { href: "/admin/orders", pathname: "/admin/orders" },
			}),
		).resolves.toEqual({
			systemAccess: access,
			user: access,
		});
		expect(auth.getAdminBootstrapFn).toHaveBeenCalledOnce();
		expect(Route.options.gcTime).toBe(0);
	});

	it("keeps application routes free of beforeLoad lifecycle work", async () => {
		const files = [
			"../../src/routes/__root.tsx",
			"../../src/routes/admin/route.tsx",
			"../../src/routes/(auth)/sign-in.tsx",
			"../../src/routes/install.tsx",
		];

		for (const file of files) {
			const source = await readFile(new URL(file, import.meta.url), "utf8");
			expect(source).not.toContain("beforeLoad:");
		}
	});

	it("admits a scoped merchant workspace without platform grants", async () => {
		const merchantAccess = {
			user: {
				id: "merchant-user",
				name: "Merchant User",
				email: "merchant@example.com",
				enabled: true,
			},
			context: {
				merchantId: "merchant-a",
				environmentId: "environment-production",
				environment: "production",
			},
			permissions: [{ module: "merchant", permissionMask: 15 }],
		};
		auth.getAdminBootstrapFn.mockResolvedValue({
			installed: true,
			access: null,
			merchant: merchantAccess,
		});
		const { Route } = await import("#/routes/admin/route");
		const loader = Route.options.loader as (input: {
			location: { href: string; pathname: string };
		}) => Promise<unknown>;

		await expect(
			loader({
				location: { href: "/admin/api-keys", pathname: "/admin/api-keys" },
			}),
		).resolves.toMatchObject({
			systemAccess: null,
			merchantAccess,
			user: merchantAccess.user,
		});
		await expect(
			loader({
				location: {
					href: "/admin/test-center/runs",
					pathname: "/admin/test-center/runs",
				},
			}),
		).resolves.toMatchObject({ merchantContext: merchantAccess.context });
	});

	it("admits platform root with a selected merchant environment", async () => {
		const access = {
			id: "root-user",
			name: "Root",
			email: "root@example.com",
			enabled: true,
			updatedAt: new Date(0),
			roles: ["root"],
			root: true,
			permissions: [],
		};
		const merchantContext = {
			merchantId: "merchant-a",
			environmentId: "environment-sandbox",
			environment: "sandbox",
		};
		auth.getAdminBootstrapFn.mockResolvedValue({
			installed: true,
			access,
			merchantContext,
		});
		const { Route } = await import("#/routes/admin/route");
		const loader = Route.options.loader as (input: {
			location: { href: string; pathname: string };
		}) => Promise<unknown>;
		await expect(
			loader({
				location: {
					href: "/admin/test-center",
					pathname: "/admin/test-center",
				},
			}),
		).resolves.toMatchObject({ merchantContext });
	});
});
