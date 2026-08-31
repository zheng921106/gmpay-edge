import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import {
	account,
	merchantEnvironments,
	merchantMemberships,
	merchants,
	paymentIngresses,
	rolePermissions,
	roles,
	user,
	userRoles,
} from "#/db/schema";
import { RBAC_REGISTERED_ACTION_MASK } from "#/features/access/rbac-bitmask";
import { merchantPaymentIngressValues } from "#/features/merchants/server/payment-ingresses";
import { DomainError } from "#/lib/domain-error";
import { type AppDb, getDb } from "#/server/db.server";

export type RegisterMerchantInput = {
	name: string;
	slug: string;
	email: string;
	password: string;
};

const registerMerchantInput = z.object({
	name: z.string().trim().min(1).max(100),
	slug: z
		.string()
		.trim()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		.max(100),
	email: z.email(),
	password: z.string().min(12).max(200),
});

export const registerMerchantFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof registerMerchantInput>) =>
		registerMerchantInput.parse(input),
	)
	.handler(async ({ data }) => registerMerchant(getDb(getRequest()), data));

export async function registerMerchant(
	db: AppDb,
	input: RegisterMerchantInput,
) {
	const name = input.name.trim();
	const slug = normalizeSlug(input.slug);
	const email = normalizeEmail(input.email);
	if (!name)
		throw new DomainError(
			"merchant_name_required",
			400,
			"Merchant name is required.",
		);
	if (input.password.length < 12)
		throw new DomainError(
			"password_too_short",
			400,
			"Password must be at least 12 characters long.",
		);
	if (
		await db.$client
			.prepare("SELECT id FROM users WHERE email = ?")
			.bind(email)
			.first()
	)
		throw new DomainError("email_in_use", 409, "Email is already in use.");
	if (
		await db.$client
			.prepare("SELECT id FROM merchants WHERE slug = ?")
			.bind(slug)
			.first()
	)
		throw new DomainError(
			"merchant_slug_in_use",
			409,
			"Merchant slug is already in use.",
		);

	const now = new Date();
	const userId = randomUUID();
	const merchantId = randomUUID();
	const sandboxId = randomUUID();
	const productionId = randomUUID();
	const environments = [{ id: sandboxId }, { id: productionId }] as const;
	const password = await hashPassword(input.password);
	const roleIds = new Map(
		["owner", "admin", "operator", "viewer"].map((name) => [
			name,
			randomUUID(),
		]),
	);
	const statements = [
		db.insert(user).values({
			id: userId,
			name,
			email,
			emailVerified: false,
			enabled: true,
			twoFactorEnabled: false,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(account).values({
			id: randomUUID(),
			accountId: userId,
			providerId: "credential",
			userId,
			password,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(merchants).values({
			id: merchantId,
			slug,
			name,
			status: "active",
			createdByUserId: userId,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(merchantEnvironments).values([
			{
				id: sandboxId,
				merchantId,
				code: "sandbox",
				status: "active",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: productionId,
				merchantId,
				code: "production",
				status: "active",
				createdAt: now,
				updatedAt: now,
			},
		]),
		...merchantPaymentIngressValues({
			merchantId,
			environments,
			now,
		}).map((ingress) => db.insert(paymentIngresses).values(ingress)),
		db.insert(merchantMemberships).values({
			id: randomUUID(),
			merchantId,
			userId,
			status: "active",
			acceptedAt: now,
			createdAt: now,
			updatedAt: now,
		}),
		...[...roleIds].map(([roleName, roleId]) =>
			db.insert(roles).values({
				id: roleId,
				merchantId,
				name: roleName,
				builtIn: true,
				enabled: true,
				createdAt: now,
				updatedAt: now,
			}),
		),
		db.insert(userRoles).values({
			id: randomUUID(),
			userId,
			roleId: roleIds.get("owner") as string,
			createdAt: now,
		}),
		...merchantRolePermissions(db, roleIds, now),
	];
	await db.batch(
		statements as [(typeof statements)[number], ...typeof statements],
	);
	return {
		merchantId,
		environmentIds: { sandbox: sandboxId, production: productionId },
		userId,
	};
}

function merchantRolePermissions(
	db: AppDb,
	roleIds: ReadonlyMap<string, string>,
	now: Date,
) {
	return [...roleIds].map(([name, roleId]) =>
		db.insert(rolePermissions).values({
			id: randomUUID(),
			roleId,
			module: "merchant",
			permissionMask: merchantRolePermissionMask(name),
			createdAt: now,
			updatedAt: now,
		}),
	);
}

function merchantRolePermissionMask(name: string) {
	if (name === "owner") return RBAC_REGISTERED_ACTION_MASK;
	if (name === "admin") return 7;
	if (name === "operator") return 3;
	return 1;
}

function normalizeEmail(value: string) {
	const email = value.trim().toLowerCase();
	if (!email.includes("@"))
		throw new DomainError("email_invalid", 400, "Email is invalid.");
	return email;
}

function normalizeSlug(value: string) {
	const slug = value.trim().toLowerCase();
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
		throw new DomainError(
			"merchant_slug_invalid",
			400,
			"Merchant slug is invalid.",
		);
	return slug;
}
