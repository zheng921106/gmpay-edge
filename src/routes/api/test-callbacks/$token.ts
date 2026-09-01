import { createFileRoute } from "@tanstack/react-router";
import { handlePaymentTestCallback } from "#/features/payment-testing/server/callback";
import { getEnv } from "#/server/db.server";

export const Route = createFileRoute("/api/test-callbacks/$token")({
	server: {
		handlers: {
			GET: ({ request }) => handlePaymentTestCallback(request, getEnv()),
			POST: ({ request }) => handlePaymentTestCallback(request, getEnv()),
		},
	},
});
