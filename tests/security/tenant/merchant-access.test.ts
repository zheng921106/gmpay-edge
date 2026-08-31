import { describe, expect, it } from "vitest";
import {
	evaluateMerchantPermission,
	type MerchantRolePermissionRow,
} from "#/features/access/server/merchant-access";

describe("merchant-scoped RBAC", () => {
	it("unions enabled roles only inside the selected merchant", () => {
		const rows: MerchantRolePermissionRow[] = [
			{
				merchantId: "merchant-a",
				userId: "user-1",
				enabled: true,
				status: "active",
				permissionMask: 2,
				module: "orders",
			},
			{
				merchantId: "merchant-a",
				userId: "user-1",
				enabled: true,
				status: "active",
				permissionMask: 4,
				module: "orders",
			},
			{
				merchantId: "merchant-b",
				userId: "user-1",
				enabled: true,
				status: "active",
				permissionMask: 8,
				module: "orders",
			},
		];
		expect(
			evaluateMerchantPermission(rows, "merchant-a", "user-1", {
				module: "orders",
				permissionMask: 6,
			}),
		).toBe(true);
		expect(
			evaluateMerchantPermission(rows, "merchant-a", "user-1", {
				module: "orders",
				permissionMask: 8,
			}),
		).toBe(false);
		expect(
			evaluateMerchantPermission(rows, "merchant-b", "user-1", {
				module: "orders",
				permissionMask: 8,
			}),
		).toBe(true);
	});

	it("fails closed for suspended memberships and disabled roles", () => {
		const rows: MerchantRolePermissionRow[] = [
			{
				merchantId: "merchant-a",
				userId: "user-1",
				enabled: false,
				status: "active",
				permissionMask: 8,
				module: "orders",
			},
			{
				merchantId: "merchant-a",
				userId: "user-1",
				enabled: true,
				status: "suspended",
				permissionMask: 8,
				module: "orders",
			},
		];
		expect(
			evaluateMerchantPermission(rows, "merchant-a", "user-1", {
				module: "orders",
				permissionMask: 8,
			}),
		).toBe(false);
	});
});
