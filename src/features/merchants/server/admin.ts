import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireMerchantAccess } from "#/features/access/server/merchant-access";
import { requireAdmin } from "#/features/access/server/require-admin";
import { systemPermission } from "#/features/access/system-rbac";
import {
	assignableMerchantRoleNames,
	listMerchantMembers,
	upsertMerchantMember,
} from "#/features/merchants/server/members";
import {
	createPlatformMerchant,
	listPlatformMerchants,
	setPlatformEnvironmentStatus,
	setPlatformMerchantStatus,
} from "#/features/merchants/server/platform";
import { getCloudflareEnv } from "#/server/db.server";

const upsertMerchantMemberInput = z.object({
	email: z.email(),
	roleName: z.enum(assignableMerchantRoleNames),
});

const createPlatformMerchantInput = z.object({
	name: z.string().trim().min(1).max(100),
	slug: z
		.string()
		.trim()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		.max(100),
	ownerEmail: z.email(),
});

const merchantStatusInput = z.object({
	merchantId: z.uuid(),
	status: z.enum(["active", "suspended"]),
});

const environmentStatusInput = merchantStatusInput.extend({
	environment: z.enum(["sandbox", "production"]),
});

export const listPlatformMerchantsFn = createServerFn({
	method: "GET",
}).handler(async () => {
	const { db } = await platformContext(systemPermission("users", "read"));
	return listPlatformMerchants(db);
});

export const createPlatformMerchantFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof createPlatformMerchantInput>) =>
		createPlatformMerchantInput.parse(input),
	)
	.handler(async ({ data }) => {
		const { db, user } = await platformContext(
			systemPermission("users", "create"),
		);
		return createPlatformMerchant(db, { ...data, actorUserId: user.id });
	});

export const setPlatformMerchantStatusFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof merchantStatusInput>) =>
		merchantStatusInput.parse(input),
	)
	.handler(async ({ data }) => {
		const { db, user } = await platformContext(
			systemPermission("users", "update"),
		);
		return setPlatformMerchantStatus(db, { ...data, actorUserId: user.id });
	});

export const setPlatformEnvironmentStatusFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof environmentStatusInput>) =>
		environmentStatusInput.parse(input),
	)
	.handler(async ({ data }) => {
		const { db, user } = await platformContext(
			systemPermission("users", "update"),
		);
		return setPlatformEnvironmentStatus(db, { ...data, actorUserId: user.id });
	});

export const listMerchantMembersFn = createServerFn({ method: "GET" }).handler(
	async () => {
		const { db, access } = await merchantContext(1);
		return listMerchantMembers(db, access.context.merchantId);
	},
);

export const upsertMerchantMemberFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof upsertMerchantMemberInput>) =>
		upsertMerchantMemberInput.parse(input),
	)
	.handler(async ({ data }) => {
		const { db, access, request } = await merchantContext(2);
		return upsertMerchantMember(db, {
			...data,
			merchantId: access.context.merchantId,
			actorUserId: access.id,
			requestId: request.headers.get("x-request-id"),
			ipAddress: request.headers.get("cf-connecting-ip"),
		});
	});

async function merchantContext(permissionMask: number) {
	const request = getRequest();
	const access = await requireMerchantAccess(request, {
		module: "merchant",
		permissionMask,
	});
	const db = getCloudflareEnv(request).DB;
	if (!db) throw new Error("D1 binding DB is unavailable");
	return { access, db, request };
}

async function platformContext(
	permission: ReturnType<typeof systemPermission>,
) {
	const request = getRequest();
	const user = await requireAdmin(request, permission);
	const db = getCloudflareEnv(request).DB;
	if (!db) throw new Error("D1 binding DB is unavailable");
	return { db, user };
}
