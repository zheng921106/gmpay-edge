import { createFileRoute } from "@tanstack/react-router";
import { getPaymentTestRunFn } from "#/features/payment-testing/server/functions";

export const Route = createFileRoute("/admin/test-center/runs/$runId")({
	loader: ({ params }) =>
		getPaymentTestRunFn({ data: { runId: params.runId } }),
	component: () => null,
});
