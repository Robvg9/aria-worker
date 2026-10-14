/**
 * Pure request validators for the ARIA private-vault API.
 * No crypto, network, database or secret handling occurs in this module.
 */
export const VAULT_FORMAT_VERSION = 1;
export const VAULT_KDF_ID = "argon2id-v1.3";
export const VAULT_KDF_PARAMS = Object.freeze({ m: 65536, t: 3, p: 4 });
export const MAX_CIPHERTEXT_B64URL_CHARS = 1_398_123;
export const MAX_REQUEST_BYTES = 1_500_000;

export type VaultConfigPayload = {
  format_version: 1;
  kdf_id: "argon2id-v1.3";
  kdf_params: { m: 65536; t: 3; p: 4 };
  kdf_salt: string;
  password_wrap_nonce: string;
  wrapped_vault_key: string;
  recovery_wrap_nonce: string;
  recovery_wrapped_vault_key: string;
};

export type RecordPayload = {
  format_version: 1;
  revision: number;
  payload_nonce: string;
  ciphertext: string;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function isBase64Url(value: unknown, exactLength: number, minLength = exactLength): value is string {
  return typeof value === "string" &&
    value.length >= minLength &&
    value.length <= exactLength &&
    value.length % 4 !== 1 &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Only public KDF metadata and encrypted key wrappers are accepted.
 * Rejecting unknown fields prevents cleartext/password/key fields from being
 * silently persisted by an API caller.
 */
export function validateVaultConfig(
  value: unknown,
  expectedVaultId: string,
): VaultConfigPayload | null {
  if (!isUuid(expectedVaultId) || !isPlainObject(value)) return null;

  const allowed = [
    "format_version",
    "kdf_id",
    "kdf_params",
    "kdf_salt",
    "password_wrap_nonce",
    "wrapped_vault_key",
    "recovery_wrap_nonce",
    "recovery_wrapped_vault_key",
  ] as const;
  if (!exactKeys(value, allowed)) return null;

  if (value.format_version !== VAULT_FORMAT_VERSION || value.kdf_id !== VAULT_KDF_ID) return null;
  if (!isPlainObject(value.kdf_params) ||
      !exactKeys(value.kdf_params, ["m", "t", "p"]) ||
      value.kdf_params.m !== VAULT_KDF_PARAMS.m ||
      value.kdf_params.t !== VAULT_KDF_PARAMS.t ||
      value.kdf_params.p !== VAULT_KDF_PARAMS.p) {
    return null;
  }

  if (!isBase64Url(value.kdf_salt, 22) ||
      !isBase64Url(value.password_wrap_nonce, 16) ||
      !isBase64Url(value.wrapped_vault_key, 64) ||
      !isBase64Url(value.recovery_wrap_nonce, 16) ||
      !isBase64Url(value.recovery_wrapped_vault_key, 64)) {
    return null;
  }

  return {
    format_version: 1,
    kdf_id: "argon2id-v1.3",
    kdf_params: { m: 65536, t: 3, p: 4 },
    kdf_salt: value.kdf_salt,
    password_wrap_nonce: value.password_wrap_nonce,
    wrapped_vault_key: value.wrapped_vault_key,
    recovery_wrap_nonce: value.recovery_wrap_nonce,
    recovery_wrapped_vault_key: value.recovery_wrapped_vault_key,
  };
}

/**
 * Store immutable encrypted revisions. The endpoint never accepts titles,
 * plaintext, owner IDs, passwords, raw keys or caller-supplied metadata.
 */
export function validateRecordPayload(value: unknown): RecordPayload | null {
  if (!isPlainObject(value) ||
      !exactKeys(value, ["format_version", "revision", "payload_nonce", "ciphertext"])) {
    return null;
  }

  if (value.format_version !== VAULT_FORMAT_VERSION ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 1 ||
      !isBase64Url(value.payload_nonce, 16) ||
      !isBase64Url(value.ciphertext, MAX_CIPHERTEXT_B64URL_CHARS, 22)) {
    return null;
  }

  return {
    format_version: 1,
    revision: value.revision as number,
    payload_nonce: value.payload_nonce,
    ciphertext: value.ciphertext,
  };
}

export function parsePagination(url: URL): { limit: number; offset: number } | null {
  const limitText = url.searchParams.get("limit");
  const offsetText = url.searchParams.get("offset");
  const limit = limitText === null ? 50 : Number(limitText);
  const offset = offsetText === null ? 0 : Number(offsetText);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    return null;
  }

  return { limit, offset };
}

export function parseOptionalRevision(url: URL): number | null | undefined {
  const value = url.searchParams.get("revision");
  if (value === null) return undefined;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return revision;
}
