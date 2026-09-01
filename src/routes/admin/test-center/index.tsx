import { createFileRoute } from "@tanstack/react-router";
import { GuidedPaymentTestPage } from "#/features/payment-testing/pages/guided-test";

export const Route = createFileRoute("/admin/test-center/")({
	component: GuidedPaymentTestPage,
});
