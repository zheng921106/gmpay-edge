import { hmac } from "@noble/hashes/hmac.js";
import { md5 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { constantTimeEqual } from "#/lib/crypto";
import { decryptSecret } from "#/lib/secrets";
import { loadRuntimeConfig } from "#/server/runtime-config";
import { hasRequiredApiScope, parseApiScopes } from "../scopes";
import { claimApiRateLimit } from "./rate-limit";

export class GmpayRateLimitError extends Error {}

export type MerchantApiPrincipal = {
	apiKeyId: string;
	merchantId: string;
	environmentId: string;
	environment: "sandbox" | "production";
	pid: string;
	secret: string;
	scopes: string[];
};

const LAST_USED_WRITE_INTERVAL_MS = 10 * 60_000;

export function gmpaySignaturePayload(
	parameters: object,
	excluded = new Set(["signature"]),
) {
	const pairs = Object.entries(parameters)
		.filter(
			([key, value]) =>
				!excluded.has(key) && value !== null && value !== undefined,
		)
		.map(([key, value]) => [key, normalizeValue(value)] as const)
		.filter(([, value]) => value !== "")
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, value]) => `${key}=${value}`);
	return pairs.join("&");
}

export function signGmpayParameters(
	parameters: object,
	secret: string,
	excluded?: Set<string>,
) {
	return bytesToHex(
		hmac(
			sha256,
			utf8ToBytes(secret),
			utf8ToBytes(gmpaySignaturePayload(parameters, excluded)),
		),
	);
}

export function signEpayParameters(
	parameters: object,
	secret: string,
	excluded = new Set(["sign", "sign_type"]),
) {
	return bytesToHex(
		md5(utf8ToBytes(`${gmpaySignaturePayload(parameters, excluded)}${secret}`)),
	);
}

export function verifyGmpaySignature(
	parameters: object,
	secret: string,
	signature: string,
	excluded?: Set<string>,
) {
	return constantTimeEqual(
		signGmpayParameters(parameters, secret, excluded),
		signature,
	);
}

export function verifyEpaySignature(
	parameters: object,
	secret: string,
	signature: string,
	excluded?: Set<string>,
) {
	return constantTimeEqual(
		signEpayParameters(parameters, secret, excluded),
		signature,
	);
}

export async function authenticateGmpayParameters(
	db: D1Database,
	parameters: object,
	requiredScope: string,
) {
	return authenticateParameters(db, parameters, requiredScope, {
		signatureField: "signature",
		verifySignature: verifyGmpaySignature,
	});
}

export async function authenticateEpayParameters(
	db: D1Database,
	parameters: object,
	requiredScope: string,
) {
	return authenticateParameters(db, parameters, requiredScope, {
		signatureField: "sign",
		excluded: new Set(["sign", "sign_type"]),
		verifySignature: verifyEpaySignature,
	});
}

async function authenticateParameters(
	db: D1Database,
	parameters: object,
	requiredScope: string,
	options: {
		signatureField: string;
		excluded?: Set<string>;
		verifySignature: typeof verifyGmpaySignature;
	},
) {
	const pid = normalizeValue(parameterValue(parameters, "pid"));
	const signature = normalizeValue(
		parameterValue(parameters, options.signatureField),
	);
	if (!(pid && signature)) return null;
	const row = await db
		.prepare(
			`SELECT k.id, k.merchant_id, k.environment_id, k.secret_encrypted,
					k.scopes, k.enabled, k.expires_at, k.revoked_at,
					m.status AS merchant_status, e.code AS environment_code,
					e.status AS environment_status
			 FROM api_keys k
			 JOIN merchants m ON m.id = k.merchant_id
			 JOIN merchant_environments e
				ON e.id = k.environment_id AND e.merchant_id = k.merchant_id
			 WHERE k.pid = ? LIMIT 1`,
		)
		.bind(pid)
		.first<{
			id: string;
			merchant_id: string;
			environment_id: string;
			secret_encrypted: string;
			scopes: string;
			enabled: number;
			expires_at: number | null;
			revoked_at: number | null;
			merchant_status: "active" | "suspended";
			environment_code: "sandbox" | "production";
			environment_status: "active" | "suspended";
		}>();
	if (
		!row ||
		row.enabled !== 1 ||
		row.merchant_status !== "active" ||
		row.environment_status !== "active" ||
		row.revoked_at ||
		(row.expires_at !== null && row.expires_at < Date.now())
	)
		return null;
	const scopes = parseApiScopes(row.scopes);
	if (!scopes) return null;
	if (!hasRequiredApiScope(scopes, requiredScope)) return null;
	const runtime = await loadRuntimeConfig(db);
	if (!runtime.apiKeyPepper) return null;
	const secret = await decryptSecret(
		row.secret_encrypted,
		runtime.apiKeyPepper,
	);
	if (!options.verifySignature(parameters, secret, signature, options.excluded))
		return null;
	const rate = await claimApiRateLimit(db, { apiKeyId: row.id, limit: 120 });
	if (!rate.allowed) throw new GmpayRateLimitError("API rate limit exceeded");
	const now = Date.now();
	await db
		.prepare(
			`UPDATE api_keys SET last_used_at = ?, updated_at = ?
			 WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)`,
		)
		.bind(now, now, row.id, now - LAST_USED_WRITE_INTERVAL_MS)
		.run();
	return {
		apiKeyId: row.id,
		merchantId: row.merchant_id,
		environmentId: row.environment_id,
		environment: row.environment_code,
		pid,
		secret,
		scopes,
	} satisfies MerchantApiPrincipal;
}

function parameterValue(parameters: object, key: string) {
	return Object.entries(parameters).find(([name]) => name === key)?.[1];
}

function normalizeValue(value: unknown) {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "";
}
