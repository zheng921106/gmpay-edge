import { describe, expect, it } from "vitest";
import {
	canAccessMerchantPath,
	merchantSidebarData,
} from "#/layouts/components/data/sidebar-data";

const readMerchantPermissions = [{ module: "merchant", permissionMask: 1 }];

describe("merchant sidebar", () => {
	it("includes the scoped receiving-method workspace for merchant readers", () => {
		const navigation = merchantSidebarData(readMerchantPermissions);
		expect(
			navigation.navGroups.flatMap((group) =>
				group.items.map((item) => item.id),
			),
		).toEqual([
			"orders",
			"test-center",
			"receiving-methods",
			"api-keys",
			"merchant-members",
		]);
		expect(
			canAccessMerchantPath(
				"/admin/receiving-methods",
				readMerchantPermissions,
			),
		).toBe(true);
		expect(
			canAccessMerchantPath(
				"/admin/test-center/runs/11111111-1111-4111-8111-111111111111",
				readMerchantPermissions,
			),
		).toBe(true);
	});
});
