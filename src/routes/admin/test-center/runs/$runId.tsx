import { createFileRoute } from "@tanstack/react-router";
import { PaymentTestRunDetailPage } from "#/features/payment-testing/pages/run-detail";
import { getPaymentTestRunFn } from "#/features/payment-testing/server/functions";

export const Route = createFileRoute("/admin/test-center/runs/$runId")({
	loader: ({ params }) =>
		getPaymentTestRunFn({ data: { runId: params.runId } }),
	component: PaymentTestRunDetailRoute,
});

function PaymentTestRunDetailRoute() {
	return <PaymentTestRunDetailPage data={Route.useLoaderData()} />;
}
