import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "#/db/schema";
import { loadAdminBootstrap } from "#/features/auth/server/admin-bootstrap";
import { createAuth } from "#/features/auth/server/auth-factory";
import { registerMerchant } from "#/features/auth/server/registration";
import { installSystem } from "#/features/installation/server/install";
import {
	findDefaultMerchantContext,
	listMerchantContexts,
	serializeMerchantContextCookie,
} from "#/server/merchant-context";
import { adaptCloudflareEnv } from "#/server/runtime/cloudflare";
import { runWithRuntimeEnv } from "#/server/runtime/context";
import { createInitialRuntimeConfig } from "#/server/runtime-config";
import { applyMigrations } from "../migrations";

const workerEnv = vi.hoisted(() => ({ bindings: {} as Partial<Env> }));

vi.mock("cloudflare:workers", () => ({
	env: workerEnv.bindings,
	waitUntil: vi.fn(),
}));

describe("merchant admin bootstrap", () => {
	let miniflare: Miniflare;
	let db: D1Database;
	let cookie: string;
	let contextCookie: string;
	let merchantId: string;
	let productionEnvironmentId: string;
	let runtimeConfig: ReturnType<typeof createInitialRuntimeConfig>;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-merchant-bootstrap" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		runtimeConfig = createInitialRuntimeConfig("https://pay.example");
		await installSystem(
			drizzle(db, { schema }),
			{
				name: "Root",
				email: "root@example.com",
				password: "exact-root-password",
			},
			runtimeConfig,
		);
		const merchant = await registerMerchant(drizzle(db, { schema }), {
			name: "Merchant Owner",
			slug: "merchant-owner",
			email: "owner@example.com",
			password: "merchant-owner-password",
		});
		merchantId = merchant.merchantId;
		productionEnvironmentId = merchant.environmentIds.production;
		const auth = createAuth(drizzle(db, { schema }), {
			BETTER_AUTH_SECRET: runtimeConfig.betterAuthSecret,
			BETTER_AUTH_URL: runtimeConfig.betterAuthUrl,
		});
		const response = await auth.api.signInEmail({
			body: {
				email: "owner@example.com",
				password: "merchant-owner-password",
			},
			asResponse: true,
		});
		cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
		contextCookie = await serializeMerchantContextCookie(
			{
				merchantId: merchant.merchantId,
				environmentId: merchant.environmentIds.production,
				environment: "production",
			},
			runtimeConfig.betterAuthSecret,
		);
	});

	afterAll(async () => miniflare.dispose());

	it("admits an active merchant owner without granting platform access", async () => {
		workerEnv.bindings.DB = db;
		await expect(
			runWithRuntimeEnv(adaptCloudflareEnv(workerEnv.bindings), () =>
				loadAdminBootstrap(
					new Request("https://pay.example/admin", {
						headers: { cookie: `${cookie}; ${contextCookie.split(";", 1)[0]}` },
					}),
				),
			),
		).resolves.toMatchObject({
			installed: true,
			access: null,
			merchant: {
				context: { environment: "production" },
				user: { email: "owner@example.com" },
			},
		});
	});

	it("selects the member's production environment by default", async () => {
		await expect(
			findDefaultMerchantContext(db, "invalid-user"),
		).resolves.toBeNull();
		const member = await db
			.prepare(
				"SELECT user_id FROM merchant_memberships WHERE merchant_id = ? LIMIT 1",
			)
			.bind(merchantId)
			.first<{ user_id: string }>();
		await expect(
			findDefaultMerchantContext(db, member?.user_id ?? ""),
		).resolves.toEqual({
			merchantId,
			environmentId: productionEnvironmentId,
			environment: "production",
		});
	});

	it("lists only the member's active merchant environments", async () => {
		const member = await db
			.prepare(
				"SELECT user_id FROM merchant_memberships WHERE merchant_id = ? LIMIT 1",
			)
			.bind(merchantId)
			.first<{ user_id: string }>();
		await expect(
			listMerchantContexts(db, {
				user: {
					id: member?.user_id ?? "",
					name: "Merchant Owner",
					email: "owner@example.com",
					enabled: true,
					updatedAt: new Date(),
				},
				root: false,
			}),
		).resolves.toEqual([
			{
				merchantId,
				environmentId: productionEnvironmentId,
				environment: "production",
				merchantName: "Merchant Owner",
				merchantSlug: "merchant-owner",
			},
			{
				merchantId,
				environmentId: expect.any(String),
				environment: "sandbox",
				merchantName: "Merchant Owner",
				merchantSlug: "merchant-owner",
			},
		]);
	});

	it("lets a root administrator select a scoped workspace when no context cookie exists", async () => {
		const auth = createAuth(drizzle(db, { schema }), {
			BETTER_AUTH_SECRET: runtimeConfig.betterAuthSecret,
			BETTER_AUTH_URL: runtimeConfig.betterAuthUrl,
		});
		const response = await auth.api.signInEmail({
			body: {
				email: "root@example.com",
				password: "exact-root-password",
			},
			asResponse: true,
		});
		const rootCookie =
			response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
		workerEnv.bindings.DB = db;
		await expect(
			runWithRuntimeEnv(adaptCloudflareEnv(workerEnv.bindings), () =>
				loadAdminBootstrap(
					new Request("https://pay.example/admin/receiving-methods", {
						headers: { cookie: rootCookie },
					}),
				),
			),
		).resolves.toMatchObject({
			installed: true,
			merchant: null,
			merchantContext: null,
		});
	});
});
