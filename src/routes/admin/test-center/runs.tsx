import { createFileRoute } from "@tanstack/react-router";
import { listPaymentTestRunsFn } from "#/features/payment-testing/server/functions";

export const Route = createFileRoute("/admin/test-center/runs")({
	loader: () => listPaymentTestRunsFn({ data: {} }),
	component: () => null,
});
