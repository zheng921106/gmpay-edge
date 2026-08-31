import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
	merchantEnvironments,
	merchantMemberships,
	merchants,
	roles,
} from "#/db/schema";

describe("multi-merchant schema contract", () => {
	it("declares tenant ownership and the two supported environments", () => {
		expect(getTableConfig(merchants).name).toBe("merchants");
		expect(getTableConfig(merchantEnvironments).name).toBe(
			"merchant_environments",
		);
		expect(getTableConfig(merchantMemberships).name).toBe(
			"merchant_memberships",
		);
		expect(merchantEnvironments.merchantId).toBeDefined();
		expect(merchantEnvironments.code).toBeDefined();
		expect(merchantMemberships.merchantId).toBeDefined();
		expect(merchantMemberships.userId).toBeDefined();
	});

	it("keeps role names unique within their scope", () => {
		expect(roles.merchantId).toBeDefined();
		const indexes = getTableConfig(roles).indexes.map(
			(index) => index.config.name,
		);
		expect(indexes).toContain("roles_merchant_name_uidx");
		expect(indexes).toContain("roles_global_name_uidx");
	});
});
