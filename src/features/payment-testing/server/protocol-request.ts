import {
	signEpayParameters,
	signGmpayParameters,
} from "#/features/api-keys/server/gmpay-signature";
import { createOrder } from "#/features/orders/server/create";
import {
	type EpayInput,
	handleEpayCreateRequest,
	parseEpayInput,
	toEpayOrderInput,
} from "#/features/orders/server/epay-adapter";
import {
	type GmpayCreateInput,
	handleGmpayCreateRequest,
	parseGmpayCreateInput,
	parseGmpayRequestBody,
	toCreateOrderInput,
} from "#/features/orders/server/gmpay-api";
import type { PaymentTestStartInput } from "#/features/payment-testing/schema";
import {
	observePaymentTestOperation,
	redactPaymentTestSnapshot,
} from "#/features/payment-testing/server/observability";
import { preflightPaymentTest } from "#/features/payment-testing/server/preflight";
import type {
	MerchantAccessContext,
	PaymentTestPreflight,
	PaymentTestRuntime,
	PaymentTestStartResult,
	RedactedProtocolSnapshot,
} from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";
import { decryptSecret } from "#/lib/secrets";
import { currencyDecimals, minorToDecimal } from "#/lib/units";
import { loadRuntimeConfig } from "#/server/runtime-config";

export async function executePaymentTestRun(
	env: PaymentTestRuntime,
	context: MerchantAccessContext,
	runId: string,
	input: PaymentTestStartInput,
): Promise<PaymentTestStartResult> {
	const preflight = await preflightPaymentTest(env.DB, context, input);
	const callback = await paymentTestCallback(context.requestOrigin, input);
	const startedAt = Date.now();
	const protocol = await observePaymentTestOperation(
		{
			operation: "protocol_request",
			protocol: input.protocol,
			environment: context.environment,
			mode: input.paymentMode,
			scenario: null,
		},
		() =>
			invokePaymentProtocol(
				env.DB,
				context,
				preflight,
				input,
				callback.url,
				runId,
			),
	);
	if (!(protocol.response.ok && protocol.orderId)) {
		await env.DB.prepare(
			`UPDATE payment_test_runs SET status = 'failed', failure_code = ?,
				 request_snapshot = ?, response_snapshot = ?, completed_at = ?, updated_at = ?
				 WHERE id = ? AND merchant_id = ? AND environment_id = ?`,
		)
			.bind(
				"protocol_request_failed",
				JSON.stringify(protocol.requestSnapshot),
				JSON.stringify(protocol.responseSnapshot),
				Date.now(),
				Date.now(),
				runId,
				context.merchantId,
				context.environmentId,
			)
			.run();
		throw new DomainError(
			"payment_test_protocol_failed",
			409,
			"The signed payment request was rejected.",
		);
	}
	await env.DB.prepare(
		`UPDATE payment_test_runs SET status = 'running', order_id = ?,
			 request_snapshot = ?, response_snapshot = ?, callback_token_hash = ?,
			 callback_token_expires_at = ?, started_at = COALESCE(started_at, ?),
			 failure_code = NULL, updated_at = ?
			 WHERE id = ? AND merchant_id = ? AND environment_id = ?`,
	)
		.bind(
			protocol.orderId,
			JSON.stringify(protocol.requestSnapshot),
			JSON.stringify(protocol.responseSnapshot),
			callback.tokenHash,
			callback.tokenExpiresAt,
			startedAt,
			Date.now(),
			runId,
			context.merchantId,
			context.environmentId,
		)
		.run();
	return {
		runId,
		orderId: protocol.orderId,
		status: "running",
		confirmationRequired: false,
	};
}

async function invokePaymentProtocol(
	db: D1Database,
	context: MerchantAccessContext,
	preflight: PaymentTestPreflight,
	input: PaymentTestStartInput,
	notifyUrl: string,
	runId: string,
) {
	const runtime = await loadRuntimeConfig(db);
	const secret = await decryptSecret(
		preflight.apiKey.secretEncrypted,
		runtime.apiKeyPepper,
	);
	const amount = minorToDecimal(
		input.amountMinor,
		currencyDecimals(input.currency),
	);
	const requestId = `payment-test-${runId}`;
	const started = performance.now();
	let request: Request;
	if (input.protocol === "gmpay") {
		const parameters = gmpayParameters(
			input,
			preflight,
			notifyUrl,
			amount,
			secret,
		);
		request = new Request(
			`${context.requestOrigin}/payments/gmpay/v1/order/create-transaction`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-request-id": requestId,
				},
				body: JSON.stringify(parameters),
			},
		);
	} else {
		const parameters = epayParameters(
			input,
			preflight,
			notifyUrl,
			amount,
			secret,
		);
		request = new Request(
			`${context.requestOrigin}/payments/epay/v1/order/create-transaction/submit.php`,
			{
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					"x-request-id": requestId,
				},
				body: new URLSearchParams(parameters),
			},
		);
	}
	const requestBody = await request.clone().text();
	const requestSnapshot: RedactedProtocolSnapshot = {
		version: 1,
		method: "POST",
		path: new URL(request.url).pathname,
		headers: {
			"content-type": request.headers.get("content-type") ?? "",
			"x-request-id": requestId,
		},
		body: redactPaymentTestSnapshot(
			input.protocol === "gmpay"
				? (parseGmpayRequestBody("application/json", requestBody) as Record<
						string,
						unknown
					>)
				: Object.fromEntries(new URLSearchParams(requestBody)),
		) as Record<string, unknown>,
	};
	const createSelectedOrder = (
		orderDb: D1Database,
		orderInput: Parameters<typeof createOrder>[1],
		requestUrl: string,
		orderContext: Parameters<typeof createOrder>[3],
	) =>
		createOrder(
			orderDb,
			{ ...orderInput, receivingMethodId: preflight.receivingMethod.id },
			requestUrl,
			orderContext,
		);
	const response =
		input.protocol === "gmpay"
			? await handleGmpayCreateRequest(
					request,
					{ DB: db },
					createSelectedOrder,
					(value) =>
						toCreateOrderInput(
							value,
							input.callback.mode === "builtin" ? notifyUrl : undefined,
						),
				)
			: await handleEpayCreateRequest(
					request,
					{ DB: db },
					createSelectedOrder,
					"gateway",
					(value) =>
						toEpayOrderInput(
							value,
							input.callback.mode === "builtin" ? notifyUrl : undefined,
						),
				);
	const responseBody: unknown = await response
		.clone()
		.json()
		.catch(() => null);
	const responseSnapshot: RedactedProtocolSnapshot = {
		version: 1,
		method: "POST",
		path: new URL(request.url).pathname,
		headers: { "x-request-id": response.headers.get("x-request-id") ?? "" },
		body: redactPaymentTestSnapshot(responseBody) as Record<
			string,
			unknown
		> | null,
		status: response.status,
		durationMs: Math.max(0, performance.now() - started),
	};
	return {
		response,
		orderId: orderIdFromResponse(responseBody),
		requestSnapshot,
		responseSnapshot,
	};
}

function gmpayParameters(
	input: PaymentTestStartInput,
	preflight: PaymentTestPreflight,
	notifyUrl: string,
	amount: string,
	secret: string,
) {
	const canonical = {
		pid: preflight.apiKey.pid,
		order_id: input.externalOrderId,
		currency: input.currency,
		token: preflight.asset.code,
		network: preflight.rail.code,
		amount,
		notify_url: notifyUrl,
		...(input.returnUrl ? { redirect_url: input.returnUrl } : {}),
		...(input.description ? { name: input.description } : {}),
	};
	const parsed = parseGmpayCreateInput({
		...canonical,
		...rawInput(input, "gmpay"),
		pid: canonical.pid,
		signature: "0".repeat(64),
	});
	if (!parsed.success || !sameGmpaySelection(parsed.data, canonical))
		throw rawInputError();
	const unsigned = { ...parsed.data, signature: undefined };
	return {
		...parsed.data,
		signature: signGmpayParameters(unsigned, secret),
	} satisfies GmpayCreateInput;
}

function epayParameters(
	input: PaymentTestStartInput,
	preflight: PaymentTestPreflight,
	notifyUrl: string,
	amount: string,
	secret: string,
) {
	const canonical = {
		pid: preflight.apiKey.pid,
		money: amount,
		out_trade_no: input.externalOrderId,
		notify_url: notifyUrl,
		type: `${preflight.asset.code.toLowerCase()}.${preflight.rail.code}`,
		...(input.returnUrl ? { return_url: input.returnUrl } : {}),
		...(input.description ? { name: input.description } : {}),
	};
	const parsed = parseEpayInput({
		...canonical,
		...rawInput(input, "epay"),
		pid: canonical.pid,
		sign: "0".repeat(32),
		sign_type: "MD5",
	});
	if (!parsed.success || !sameEpaySelection(parsed.data, canonical))
		throw rawInputError();
	const unsigned = { ...parsed.data, sign: undefined };
	return {
		...parsed.data,
		sign: signEpayParameters(unsigned, secret),
		sign_type: "MD5",
	} satisfies EpayInput;
}

function rawInput(input: PaymentTestStartInput, protocol: "gmpay" | "epay") {
	if (!input.rawInput) return {};
	if (protocol === "epay")
		return Object.fromEntries(new URLSearchParams(input.rawInput));
	return parseGmpayRequestBody("application/json", input.rawInput) ?? {};
}

function sameGmpaySelection(
	value: GmpayCreateInput,
	canonical: Omit<GmpayCreateInput, "signature">,
) {
	return (
		value.order_id === canonical.order_id &&
		value.currency === canonical.currency &&
		value.amount === canonical.amount &&
		value.token === canonical.token &&
		value.network === canonical.network &&
		value.notify_url === canonical.notify_url
	);
}

function sameEpaySelection(
	value: EpayInput,
	canonical: Omit<EpayInput, "sign" | "sign_type">,
) {
	return (
		value.out_trade_no === canonical.out_trade_no &&
		value.money === canonical.money &&
		value.type === canonical.type &&
		value.notify_url === canonical.notify_url
	);
}

function rawInputError() {
	return new DomainError(
		"payment_test_raw_input_mismatch",
		400,
		"Raw protocol input conflicts with the selected payment test resources.",
	);
}

function orderIdFromResponse(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const data = "data" in value ? value.data : null;
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	return "trade_id" in data && typeof data.trade_id === "string"
		? data.trade_id
		: null;
}

async function paymentTestCallback(
	origin: string,
	input: PaymentTestStartInput,
) {
	if (input.callback.mode === "custom")
		return { url: input.callback.url, tokenHash: null, tokenExpiresAt: null };
	const token = randomToken();
	return {
		url: `${origin}/api/test-callbacks/${token}`,
		tokenHash: await sha256Hex(token),
		tokenExpiresAt: Date.now() + 7 * 86_400_000,
	};
}

function randomToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return toBase64Url(bytes);
}

async function sha256Hex(value: string) {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
	);
	return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(value: Uint8Array) {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}
