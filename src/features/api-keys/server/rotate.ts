import type { ApiKeyScope } from "#/features/api-keys/server/list";
import { DomainError } from "#/lib/domain-error";
import { encryptSecret, generateApiSecret } from "#/lib/secrets";

export async function rotateApiKeyCredential(
	db: D1Database,
	input: ApiKeyScope & { id: string; pepper: string; now?: number },
) {
	const secret = generateApiSecret();
	const now = input.now ?? Date.now();
	const result = await db
		.prepare(`UPDATE api_keys
			SET secret_encrypted = ?, updated_at = ?
			WHERE id = ? AND merchant_id = ? AND environment_id = ?
			  AND revoked_at IS NULL
			RETURNING pid`)
		.bind(
			await encryptSecret(secret, input.pepper),
			now,
			input.id,
			input.merchantId,
			input.environmentId,
		)
		.first<{ pid: string }>();
	if (!result) {
		const key = await db
			.prepare(
				"SELECT revoked_at FROM api_keys WHERE id = ? AND merchant_id = ? AND environment_id = ? LIMIT 1",
			)
			.bind(input.id, input.merchantId, input.environmentId)
			.first<{ revoked_at: number | null }>();
		if (!key)
			throw new DomainError("api_key_not_found", 404, "API key not found");
		throw new DomainError("api_key_revoked", 409, "API key is revoked");
	}
	return { id: input.id, pid: result.pid, secret, rotatedAt: now };
}
