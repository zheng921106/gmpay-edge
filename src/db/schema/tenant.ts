import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { timestamps } from "./common";

export const merchantStatuses = ["active", "suspended"] as const;
export type MerchantStatus = (typeof merchantStatuses)[number];

export const merchantEnvironmentCodes = ["sandbox", "production"] as const;
export type MerchantEnvironmentCode = (typeof merchantEnvironmentCodes)[number];

export const merchantEnvironmentStatuses = ["active", "suspended"] as const;
export type MerchantEnvironmentStatus =
	(typeof merchantEnvironmentStatuses)[number];

export const merchantMembershipStatuses = [
	"active",
	"invited",
	"suspended",
] as const;
export type MerchantMembershipStatus =
	(typeof merchantMembershipStatuses)[number];

export type MerchantEnvironmentContext = {
	merchantId: string;
	environmentId: string;
	environment: MerchantEnvironmentCode;
};

export const merchants = sqliteTable(
	"merchants",
	{
		id: text("id").primaryKey(),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		status: text("status").$type<MerchantStatus>().notNull().default("active"),
		createdByUserId: text("created_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		...timestamps,
	},
	(table) => [
		uniqueIndex("merchants_slug_uidx").on(table.slug),
		index("merchants_status_idx").on(table.status, table.id),
	],
);

export const merchantEnvironments = sqliteTable(
	"merchant_environments",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id")
			.notNull()
			.references(() => merchants.id, { onDelete: "cascade" }),
		code: text("code").$type<MerchantEnvironmentCode>().notNull(),
		status: text("status")
			.$type<MerchantEnvironmentStatus>()
			.notNull()
			.default("active"),
		...timestamps,
	},
	(table) => [
		uniqueIndex("merchant_environments_merchant_code_uidx").on(
			table.merchantId,
			table.code,
		),
		index("merchant_environments_status_idx").on(table.status, table.id),
	],
);

export const merchantMemberships = sqliteTable(
	"merchant_memberships",
	{
		id: text("id").primaryKey(),
		merchantId: text("merchant_id")
			.notNull()
			.references(() => merchants.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		status: text("status")
			.$type<MerchantMembershipStatus>()
			.notNull()
			.default("active"),
		invitedByUserId: text("invited_by_user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		invitedAt: integer("invited_at", { mode: "timestamp_ms" }),
		acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
		...timestamps,
	},
	(table) => [
		uniqueIndex("merchant_memberships_merchant_user_uidx").on(
			table.merchantId,
			table.userId,
		),
		index("merchant_memberships_user_idx").on(table.userId, table.status),
		index("merchant_memberships_merchant_idx").on(
			table.merchantId,
			table.status,
		),
	],
);
