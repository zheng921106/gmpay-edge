import { createFileRoute } from "@tanstack/react-router";
import { MerchantAdminPage } from "#/features/merchants/pages/admin";

export const Route = createFileRoute("/admin/access/merchants")({
	component: MerchantAdminPage,
});
