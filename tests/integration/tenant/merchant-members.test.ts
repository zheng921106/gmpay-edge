import { drizzle } from "drizzle-orm/d1";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "#/db/schema";
import { registerMerchant } from "#/features/auth/server/registration";
import {
	listMerchantMembers,
	upsertMerchantMember,
} from "#/features/merchants/server/members";
import { applyMigrations } from "../migrations";

describe("merchant membership roles", () => {
	let miniflare: Miniflare;
	let db: D1Database;
	let merchantAId: string;
	let merchantBId: string;
	let ownerAId: string;
	let ownerBId: string;

	beforeAll(async () => {
		miniflare = new Miniflare({
			modules: true,
			script: "export default { fetch() { return new Response('ok') } }",
			d1Databases: { DB: "gmpay-edge-merchant-members" },
		});
		db = await miniflare.getD1Database("DB");
		await applyMigrations(db);
		const merchantA = await registerMerchant(drizzle(db, { schema }), {
			name: "Merchant A",
			slug: "merchant-a",
			email: "owner-a@example.com",
			password: "merchant-a-owner-password",
		});
		const merchantB = await registerMerchant(drizzle(db, { schema }), {
			name: "Merchant B",
			slug: "merchant-b",
			email: "owner-b@example.com",
			password: "merchant-b-owner-password",
		});
		merchantAId = merchantA.merchantId;
		merchantBId = merchantB.merchantId;
		ownerAId = merchantA.userId;
		ownerBId = merchantB.userId;
	});

	afterAll(async () => miniflare.dispose());

	it("adds a member with a merchant-local role without changing other memberships", async () => {
		await upsertMerchantMember(db, {
			merchantId: merchantAId,
			email: "owner-b@example.com",
			roleName: "operator",
			actorUserId: ownerAId,
			now: 1_800_000_000_000,
		});
		await expect(listMerchantMembers(db, merchantAId)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					userId: ownerAId,
					roleName: "owner",
					status: "active",
				}),
				expect.objectContaining({
					userId: ownerBId,
					roleName: "operator",
					status: "active",
				}),
			]),
		);
		await expect(listMerchantMembers(db, merchantBId)).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					userId: ownerBId,
					roleName: "owner",
					status: "active",
				}),
			]),
		);
	});
});
