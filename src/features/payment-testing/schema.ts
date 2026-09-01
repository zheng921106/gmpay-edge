import { z } from "zod";
import {
	paymentTestExpectedOutcomes,
	paymentTestModes,
	paymentTestProtocols,
} from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";

const callbackSchema = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("builtin") }),
	z.object({
		mode: z.literal("custom"),
		url: z.url().refine((value) => value.startsWith("https://")),
	}),
]);

export const paymentTestStartInputSchema = z.object({
	protocol: z.enum(paymentTestProtocols),
	paymentMode: z.enum(paymentTestModes),
	apiKeyId: z.uuid(),
	receivingMethodId: z.uuid(),
	paymentAssetId: z.string().trim().min(1).max(100),
	amountMinor: z.string().regex(/^[1-9]\d*$/),
	currency: z
		.string()
		.trim()
		.length(3)
		.transform((value) => value.toUpperCase()),
	externalOrderId: z.string().trim().min(1).max(128),
	clientIdempotencyKey: z.string().trim().min(8).max(128),
	callback: callbackSchema,
	returnUrl: z
		.url()
		.refine((value) => value.startsWith("https://"))
		.optional(),
	description: z.string().trim().max(500).optional(),
	expectedOutcome: z.enum(paymentTestExpectedOutcomes).default("paid"),
	rawInput: z
		.string()
		.max(64 * 1024)
		.optional(),
});

export type PaymentTestStartInput = z.input<typeof paymentTestStartInputSchema>;

export function parsePaymentTestStartInput(value: unknown) {
	const parsed = paymentTestStartInputSchema.safeParse(value);
	if (!parsed.success)
		throw new DomainError(
			"payment_test_input_invalid",
			400,
			"Payment test input is invalid.",
		);
	return parsed.data;
}

export function callbackDestinationSnapshot(input: PaymentTestStartInput) {
	return input.callback.mode === "builtin"
		? { kind: "builtin" as const, display: "Built-in test callback" }
		: { kind: "custom" as const, display: input.callback.url };
}

export function parseStoredPaymentTestInput(snapshot: string | null) {
	try {
		const parsed: unknown = JSON.parse(snapshot ?? "null");
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error();
		return parsePaymentTestStartInput(
			"body" in parsed ? (parsed as { body: unknown }).body : null,
		);
	} catch {
		throw new DomainError(
			"payment_test_confirmation_invalid",
			400,
			"Payment test confirmation is invalid.",
		);
	}
}
