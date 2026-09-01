import { z } from "zod";
import {
	callbackDestinationSnapshot,
	type PaymentTestStartInput,
	parseStoredPaymentTestInput,
} from "#/features/payment-testing/schema";
import { preflightPaymentTest } from "#/features/payment-testing/server/preflight";
import { executePaymentTestRun } from "#/features/payment-testing/server/protocol-request";
import type {
	MerchantAccessContext,
	PaymentTestRuntime,
	PaymentTestStartResult,
} from "#/features/payment-testing/types";
import { DomainError } from "#/lib/domain-error";
import { loadRuntimeConfig } from "#/server/runtime-config";

const confirmationLifetimeMs = 5 * 60_000;
const tokenPayloadSchema = z.object({
	version: z.literal(1),
	runId: z.uuid(),
	userId: z.string().min(1),
	merchantId: z.string().min(1),
	environmentId: z.string().min(1),
	protocol: z.string(),
	apiKeyId: z.string(),
	receivingMethodId: z.string(),
	paymentAssetId: z.string(),
	amountMinor: z.string(),
	currency: z.string(),
	callbackDigest: z.string(),
	inputDigest: z.string(),
	nonce: z.string(),
	expiresAt: z.number().int(),
});

export async function issueProductionConfirmation(
	runId: string,
	context: MerchantAccessContext,
	input: PaymentTestStartInput,
	now: number,
	db: D1Database,
) {
	const secret = (await loadRuntimeConfig(db)).apiKeyPepper;
	const nonce = randomToken();
	const payload = {
		version: 1 as const,
		runId,
		userId: context.userId,
		merchantId: context.merchantId,
		environmentId: context.environmentId,
		protocol: input.protocol,
		apiKeyId: input.apiKeyId,
		receivingMethodId: input.receivingMethodId,
		paymentAssetId: input.paymentAssetId,
		amountMinor: input.amountMinor,
		currency: input.currency,
		callbackDigest: await sha256Hex(JSON.stringify(input.callback)),
		inputDigest: await sha256Hex(JSON.stringify(input)),
		nonce,
		expiresAt: now + confirmationLifetimeMs,
	};
	const encoded = toBase64Url(
		new TextEncoder().encode(JSON.stringify(payload)),
	);
	return {
		token: `${encoded}.${await sign(encoded, secret)}`,
		nonceHash: await sha256Hex(nonce),
		expiresAt: payload.expiresAt,
	};
}

export async function confirmProductionPaymentTestRun(
	env: PaymentTestRuntime,
	context: MerchantAccessContext,
	input: { runId: string; confirmationToken: string },
): Promise<PaymentTestStartResult> {
	const invalid = confirmationError();
	const runtime = await loadRuntimeConfig(env.DB);
	const payload = await parseAndVerifyToken(
		input.confirmationToken,
		runtime.apiKeyPepper,
	).catch(() => null);
	if (!payload || payload.runId !== input.runId) throw invalid;
	const row = await env.DB.prepare(
		`SELECT request_snapshot, callback_destination_snapshot,
			 confirmation_nonce_hash, confirmation_expires_at,
			 confirmation_consumed_at, status
			 FROM payment_test_runs WHERE id = ? AND merchant_id = ?
			 AND environment_id = ? AND created_by_user_id = ?
			 AND payment_mode = 'live' LIMIT 1`,
	)
		.bind(
			input.runId,
			context.merchantId,
			context.environmentId,
			context.userId,
		)
		.first<{
			request_snapshot: string;
			callback_destination_snapshot: string;
			confirmation_nonce_hash: string | null;
			confirmation_expires_at: number | null;
			confirmation_consumed_at: number | null;
			status: string;
		}>();
	if (!row) throw invalid;
	const storedInput = parseStoredPaymentTestInput(row.request_snapshot);
	const now = Date.now();
	if (
		payload.userId !== context.userId ||
		payload.merchantId !== context.merchantId ||
		payload.environmentId !== context.environmentId ||
		payload.protocol !== storedInput.protocol ||
		payload.apiKeyId !== storedInput.apiKeyId ||
		payload.receivingMethodId !== storedInput.receivingMethodId ||
		payload.paymentAssetId !== storedInput.paymentAssetId ||
		payload.amountMinor !== storedInput.amountMinor ||
		payload.currency !== storedInput.currency ||
		payload.callbackDigest !==
			(await sha256Hex(JSON.stringify(storedInput.callback))) ||
		payload.inputDigest !== (await sha256Hex(JSON.stringify(storedInput))) ||
		row.callback_destination_snapshot !==
			JSON.stringify(callbackDestinationSnapshot(storedInput)) ||
		row.confirmation_nonce_hash !== (await sha256Hex(payload.nonce)) ||
		row.confirmation_consumed_at !== null ||
		row.confirmation_expires_at === null ||
		row.confirmation_expires_at < now ||
		payload.expiresAt < now ||
		row.status !== "ready"
	)
		throw invalid;
	await preflightPaymentTest(env.DB, context, storedInput);
	const consumed = await env.DB.prepare(
		`UPDATE payment_test_runs SET confirmation_consumed_at = ?,
			 status = 'running', started_at = ?, updated_at = ?
			 WHERE id = ? AND merchant_id = ? AND environment_id = ?
			 AND created_by_user_id = ? AND confirmation_consumed_at IS NULL
			 AND confirmation_expires_at >= ? AND status = 'ready'`,
	)
		.bind(
			now,
			now,
			now,
			input.runId,
			context.merchantId,
			context.environmentId,
			context.userId,
			now,
		)
		.run();
	if ((consumed.meta.changes ?? 0) !== 1) throw invalid;
	return executePaymentTestRun(env, context, input.runId, storedInput);
}

async function parseAndVerifyToken(token: string, secret: string) {
	const [encoded, signature] = token.split(".");
	if (!(encoded && signature)) throw confirmationError();
	const key = await hmacKey(secret, ["verify"]);
	const valid = await crypto.subtle.verify(
		"HMAC",
		key,
		fromBase64Url(signature),
		new TextEncoder().encode(encoded),
	);
	if (!valid) throw confirmationError();
	return tokenPayloadSchema.parse(
		JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))),
	);
}

async function sign(value: string, secret: string) {
	const signature = await crypto.subtle.sign(
		"HMAC",
		await hmacKey(secret, ["sign"]),
		new TextEncoder().encode(value),
	);
	return toBase64Url(new Uint8Array(signature));
}

function hmacKey(secret: string, usages: KeyUsage[]) {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		usages,
	);
}

function randomToken() {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
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

function fromBase64Url(value: string) {
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function confirmationError() {
	return new DomainError(
		"payment_test_confirmation_invalid",
		400,
		"Payment test confirmation is invalid.",
	);
}
