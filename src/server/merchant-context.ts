import { z } from "zod";
import type { MerchantEnvironmentContext } from "#/db/schema";
import {
	AccessDeniedError,
	type EffectiveUserAccess,
} from "#/features/access/server/access-cache";
import { getCloudflareEnv } from "#/server/db.server";
import { loadRequestRuntimeConfig } from "#/server/runtime-config";

export const merchantContextCookieName = "GMPAY_MERCHANT_CONTEXT";
export const merchantContextMaxAgeSeconds = 8 * 60 * 60;
const merchantContextVersion = 1;
const encoder = new TextEncoder();

const signedContextSchema = z.object({
	v: z.literal(merchantContextVersion),
	merchantId: z.string().min(1).max(128),
	environmentId: z.string().min(1).max(128),
	environment: z.enum(["sandbox", "production"]),
	exp: z.number().int().positive(),
	nonce: z.string().min(16).max(128),
});

export type SignedMerchantContext = MerchantEnvironmentContext;

export async function signMerchantContext(
	context: MerchantEnvironmentContext,
	secret: string,
	now = Date.now(),
) {
	const payload = {
		v: merchantContextVersion,
		...context,
		exp: now + merchantContextMaxAgeSeconds * 1000,
		nonce: randomNonce(),
	};
	const encodedPayload = encodeBase64Url(JSON.stringify(payload));
	const signature = await sign(encodedPayload, secret);
	return `${encodedPayload}.${signature}`;
}

export async function parseMerchantContextCookie(
	value: string,
	secret: string,
	now = Date.now(),
): Promise<SignedMerchantContext | null> {
	const [encodedPayload, encodedSignature, ...extra] = value.split(".");
	if (!encodedPayload || !encodedSignature || extra.length > 0) return null;
	if (!(await verify(encodedPayload, encodedSignature, secret))) return null;
	try {
		const payload = signedContextSchema.parse(
			JSON.parse(decodeBase64Url(encodedPayload)),
		);
		if (payload.exp <= now) return null;
		return {
			merchantId: payload.merchantId,
			environmentId: payload.environmentId,
			environment: payload.environment,
		};
	} catch {
		return null;
	}
}

export async function serializeMerchantContextCookie(
	context: MerchantEnvironmentContext,
	secret: string,
	now = Date.now(),
) {
	const value = await signMerchantContext(context, secret, now);
	return `${merchantContextCookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${merchantContextMaxAgeSeconds}`;
}

export async function setMerchantContext(
	request: Request,
	context: MerchantEnvironmentContext,
) {
	const db = getCloudflareEnv(request).DB;
	if (!db) throw new Error("D1 binding DB is unavailable");
	const config = await loadRequestRuntimeConfig(
		request,
		db,
		new URL(request.url).origin,
	);
	if (!config.betterAuthSecret)
		throw new Error("Context signing secret is unavailable");
	return serializeMerchantContextCookie(context, config.betterAuthSecret);
}

export function clearMerchantContext() {
	return `${merchantContextCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function loadMerchantContext(
	request: Request,
	access: Pick<EffectiveUserAccess, "user" | "root">,
): Promise<MerchantEnvironmentContext> {
	const db = getCloudflareEnv(request).DB;
	if (!db) throw new Error("D1 binding DB is unavailable");
	const config = await loadRequestRuntimeConfig(
		request,
		db,
		new URL(request.url).origin,
	);
	const rawCookie = readCookie(
		request.headers.get("cookie"),
		merchantContextCookieName,
	);
	if (!rawCookie || !config.betterAuthSecret) throw new AccessDeniedError(403);
	const context = await parseMerchantContextCookie(
		rawCookie,
		config.betterAuthSecret,
	);
	if (!context) throw new AccessDeniedError(403);

	const merchant = access.root
		? await db
				.prepare("SELECT id FROM merchants WHERE id = ? AND status = 'active'")
				.bind(context.merchantId)
				.first<{ id: string }>()
		: await db
				.prepare(
					`SELECT m.id
					 FROM merchant_memberships mm
					 JOIN merchants m ON m.id = mm.merchant_id
					 WHERE mm.user_id = ? AND mm.merchant_id = ?
					   AND mm.status = 'active' AND m.status = 'active'`,
				)
				.bind(access.user.id, context.merchantId)
				.first<{ id: string }>();
	if (!merchant) throw new AccessDeniedError(403);

	const environment = await db
		.prepare(
			`SELECT id, code
			 FROM merchant_environments
			 WHERE id = ? AND merchant_id = ? AND code = ? AND status = 'active'`,
		)
		.bind(context.environmentId, context.merchantId, context.environment)
		.first<{ id: string; code: "sandbox" | "production" }>();
	if (!environment) throw new AccessDeniedError(403);
	return {
		merchantId: context.merchantId,
		environmentId: environment.id,
		environment: environment.code,
	};
}

function readCookie(header: string | null, name: string) {
	return header
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1);
}

async function sign(value: string, secret: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return encodeBase64Url(
		new Uint8Array(
			await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
		),
	);
}

async function verify(value: string, signature: string, secret: string) {
	try {
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		return crypto.subtle.verify(
			"HMAC",
			key,
			decodeBase64UrlBytes(signature),
			encoder.encode(value),
		);
	} catch {
		return false;
	}
}

function randomNonce() {
	return encodeBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

function encodeBase64Url(value: string | Uint8Array) {
	const bytes = typeof value === "string" ? encoder.encode(value) : value;
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function decodeBase64Url(value: string) {
	return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string) {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	return Uint8Array.from(
		atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
		(char) => char.charCodeAt(0),
	);
}
