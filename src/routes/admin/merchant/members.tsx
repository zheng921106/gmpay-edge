import { createFileRoute } from "@tanstack/react-router";
import { MerchantMembersPage } from "#/features/merchants/pages/members";

export const Route = createFileRoute("/admin/merchant/members")({
	component: MerchantMembersPage,
});
