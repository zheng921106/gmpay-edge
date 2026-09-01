import { createFileRoute } from "@tanstack/react-router";
import { PaymentTestHistoryPage } from "#/features/payment-testing/pages/history";
import { validateProTableSearch } from "#/lib/pro-table-url-state";

export const Route = createFileRoute("/admin/test-center/runs/")({
	validateSearch: validateProTableSearch,
	component: PaymentTestHistoryPage,
});
