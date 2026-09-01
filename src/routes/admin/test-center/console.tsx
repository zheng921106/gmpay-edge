import { createFileRoute } from "@tanstack/react-router";
import { PaymentTestApiConsolePage } from "#/features/payment-testing/pages/api-console";

export const Route = createFileRoute("/admin/test-center/console")({
	component: PaymentTestApiConsolePage,
});
