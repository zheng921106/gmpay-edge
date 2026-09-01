import {
	verifyEpaySignature,
	verifyGmpaySignature,
} from "#/features/api-keys/server/gmpay-signature";
import { reconcilePaymentTestRun } from "#/features/payment-testing/server/timeline";
import { sha256Hex } from "#/lib/crypto";
import { decryptSecret } from "#/lib/secrets";
import { redactAuditValue } from "#/server/audit-redaction";
import {
	RequestBodyTooLargeError,
	readLimitedRequestText,
} from "#/server/request-body";
import { loadRuntimeConfig } from "#/server/runtime-config";

const maximumCallbackBytes = 64 * 1024;
const callbackTokenPattern = /^[A-Za-z0-9_-]{43}$/;

type CallbackRow = {
	run_id: string;
	protocol: "gmpay" | "epay";
	secret_encrypted: string;
	event_id: string;
	delivery_id: string;
};

export async function handlePaymentTestCallback(
	request: Request,
	env: { DB: D1Database },
): Promise<Response> {
	try {
		const token = paymentTestCallbackToken(request.url);
		const eventId = boundedHeader(request, "x-gmpay-event-id", 128);
		const deliveryId = boundedHeader(request, "x-gmpay-delivery-id", 128);
		const attempt = Number(boundedHeader(request, "x-gmpay-attempt", 3));
		if (
			!token ||
			!eventId ||
			!deliveryId ||
			!Number.isInteger(attempt) ||
			attempt < 1 ||
			attempt > 100
		)
			return invalidCallback();
		const row = await loadCallbackRow(
			env.DB,
			await sha256Hex(token),
			eventId,
			deliveryId,
		);
		if (!row) return invalidCallback();
		const parsed = await parseCallbackParameters(request, row.protocol);
		if (!parsed) return invalidCallback();
		const runtime = await loadRuntimeConfig(env.DB);
		if (!runtime.apiKeyPepper) return invalidCallback();
		const secret = await decryptSecret(
			row.secret_encrypted,
			runtime.apiKeyPepper,
		);
		const signature =
			row.protocol === "gmpay"
				? stringParameter(parsed.parameters, "signature")
				: stringParameter(parsed.parameters, "sign");
		const valid =
			row.protocol === "gmpay"
				? verifyGmpaySignature(parsed.parameters, secret, signature)
				: verifyEpaySignature(parsed.parameters, secret, signature);
		const acknowledgement = valid
			? row.protocol === "gmpay"
				? "ok"
				: "success"
			: "invalid";
		const now = Date.now();
		const inserted = await env.DB.prepare(
			`INSERT OR IGNORE INTO payment_test_callback_receipts
			 (id, run_id, event_id, delivery_id, attempt, signature_status,
			  request_headers, request_body, response_acknowledgement,
			  received_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				crypto.randomUUID(),
				row.run_id,
				row.event_id,
				row.delivery_id,
				attempt,
				valid ? "valid" : "invalid",
				JSON.stringify(redactedHeaders(request.headers)),
				JSON.stringify(redactAuditValue(parsed.parameters)),
				acknowledgement,
				now,
				now,
				now,
			)
			.run();
		if ((inserted.meta.changes ?? 0) === 0) {
			const existing = await env.DB.prepare(
				"SELECT signature_status, response_acknowledgement FROM payment_test_callback_receipts WHERE delivery_id = ? AND attempt = ? LIMIT 1",
			)
				.bind(row.delivery_id, attempt)
				.first<{
					signature_status: string;
					response_acknowledgement: string;
				}>();
			if (existing?.signature_status !== "valid") return invalidCallback();
			return acknowledgementResponse(existing.response_acknowledgement);
		}
		if (!valid) return invalidCallback();
		await reconcilePaymentTestRun(env.DB, row.run_id);
		return acknowledgementResponse(acknowledgement);
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) return invalidCallback();
		return invalidCallback();
	}
}

export async function isInstanceOwnedPaymentTestCallback(
	db: D1Database,
	url: string,
	instanceOrigin: string,
	orderId: string,
) {
	const token = paymentTestCallbackToken(url);
	if (!token || !instanceOrigin) return false;
	try {
		const target = new URL(url);
		const instance = new URL(instanceOrigin);
		if (
			target.origin !== instance.origin ||
			target.search ||
			target.hash ||
			target.username ||
			target.password
		)
			return false;
	} catch {
		return false;
	}
	const row = await db
		.prepare(
			`SELECT id FROM payment_test_runs
			 WHERE order_id = ? AND callback_mode = 'builtin'
			 AND callback_token_hash = ? AND callback_token_expires_at >= ?
			 AND status IN ('running', 'passed') LIMIT 1`,
		)
		.bind(orderId, await sha256Hex(token), Date.now())
		.first<{ id: string }>();
	return Boolean(row);
}

function paymentTestCallbackToken(url: string) {
	try {
		const path = new URL(url).pathname;
		const match = /^\/api\/test-callbacks\/([^/]+)$/.exec(path);
		const token = match?.[1] ?? "";
		return callbackTokenPattern.test(token) ? token : null;
	} catch {
		return null;
	}
}

async function loadCallbackRow(
	db: D1Database,
	tokenHash: string,
	eventId: string,
	deliveryId: string,
) {
	return db
		.prepare(
			`SELECT run.id AS run_id, run.protocol, key_record.secret_encrypted,
			 event.id AS event_id, delivery.id AS delivery_id
			 FROM payment_test_runs run
			 JOIN api_keys key_record ON key_record.id = run.api_key_id
			  AND key_record.merchant_id = run.merchant_id
			  AND key_record.environment_id = run.environment_id
			 JOIN webhook_events event ON event.id = ? AND event.order_id = run.order_id
			 JOIN webhook_deliveries delivery ON delivery.id = ?
			  AND delivery.event_id = event.id AND delivery.order_id = run.order_id
			  AND delivery.api_key_id = run.api_key_id
			 WHERE run.callback_mode = 'builtin' AND run.callback_token_hash = ?
			 AND run.callback_token_expires_at >= ?
			 AND run.status IN ('running', 'passed') LIMIT 1`,
		)
		.bind(eventId, deliveryId, tokenHash, Date.now())
		.first<CallbackRow>();
}

async function parseCallbackParameters(
	request: Request,
	protocol: "gmpay" | "epay",
) {
	if (protocol === "epay") {
		if (request.method !== "GET") return null;
		const parameters = Object.fromEntries(new URL(request.url).searchParams);
		return JSON.stringify(parameters).length <= maximumCallbackBytes
			? { parameters }
			: null;
	}
	if (request.method !== "POST") return null;
	const text = await readLimitedRequestText(request, maximumCallbackBytes);
	const parsed: unknown = JSON.parse(text);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		return null;
	return { parameters: parsed as Record<string, unknown> };
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
	const value = parameters[key];
	return typeof value === "string" ? value : "";
}

function boundedHeader(request: Request, name: string, maximum: number) {
	const value = request.headers.get(name) ?? "";
	return value.length <= maximum ? value : "";
}

function redactedHeaders(headers: Headers) {
	return redactAuditValue(Object.fromEntries(headers)) as Record<
		string,
		unknown
	>;
}

function invalidCallback() {
	return new Response("invalid", {
		status: 400,
		headers: responseHeaders,
	});
}

function acknowledgementResponse(value: string) {
	return new Response(value, { status: 200, headers: responseHeaders });
}

const responseHeaders = {
	"content-type": "text/plain; charset=utf-8",
	"cache-control": "no-store",
	"x-content-type-options": "nosniff",
};
