import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePrivateVaultRequest } from "../aria-app-api-v3/private-vault.ts";
import {
  MAX_CIPHERTEXT_B64URL_CHARS,
  parseOptionalRevision,
  parsePagination,
  validateRecordPayload,
  validateVaultConfig,
} from "../_shared/private-vault-contract.ts";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "22222222-2222-4222-8222-222222222222";
const validVaultConfig = () => ({
  format_version: 1,
  kdf_id: "argon2id-v1.3",
  kdf_params: { m: 65536, t: 3, p: 4 },
  kdf_salt: "S".repeat(22),
  password_wrap_nonce: "N".repeat(16),
  wrapped_vault_key: "W".repeat(64),
  recovery_wrap_nonce: "R".repeat(16),
  recovery_wrapped_vault_key: "K".repeat(64),
});
const validRecord = () => ({
  format_version: 1,
  revision: 1,
  payload_nonce: "N".repeat(16),
  ciphertext: "C".repeat(22),
});

Deno.test("vault config accepts only the pinned v1 cryptographic envelope", () => {
  const config = validVaultConfig();
  const actual = validateVaultConfig(config, VAULT_ID);
  assert(actual !== null);
  assertEquals(actual?.format_version, 1);
  assertEquals(actual?.kdf_id, "argon2id-v1.3");
  assertEquals(actual?.kdf_params, { m: 65536, t: 3, p: 4 });
  assertEquals(actual?.wrapped_vault_key, config.wrapped_vault_key);
});

Deno.test("vault config rejects client-supplied plaintext and unknown fields", () => {
  for (const field of ["title", "content", "password", "key", "owner_id", "user_id", "recovery_key"]) {
    const input = { ...validVaultConfig(), [field]: "synthetic-plaintext-must-not-be-stored" };
    assertEquals(validateVaultConfig(input, VAULT_ID), null, `unexpectedly accepted field ${field}`);
  }
});

Deno.test("vault config rejects altered KDF profile, malformed UUIDs and malformed wraps", () => {
  const badKdf = { ...validVaultConfig(), kdf_params: { m: 1, t: 1, p: 1 } };
  assertEquals(validateVaultConfig(badKdf, VAULT_ID), null);
  assertEquals(validateVaultConfig(validVaultConfig(), "not-a-uuid"), null);
  assertEquals(validateVaultConfig({ ...validVaultConfig(), kdf_salt: "short" }, VAULT_ID), null);
  assertEquals(validateVaultConfig({ ...validVaultConfig(), wrapped_vault_key: "W".repeat(63) }, VAULT_ID), null);
  assertEquals(validateVaultConfig({ ...validVaultConfig(), password_wrap_nonce: "N".repeat(15) }, VAULT_ID), null);
});

Deno.test("record envelope accepts ciphertext-only immutable revision input", () => {
  const payload = validRecord();
  const actual = validateRecordPayload(payload);
  assert(actual !== null);
  assertEquals(actual, payload);
});

Deno.test("record envelope rejects extra content, ownership and key fields", () => {
  for (const field of ["title", "body", "content", "plaintext", "password", "key", "owner_id", "user_id", "metadata"]) {
    const input = { ...validRecord(), [field]: "synthetic-private-text" };
    assertEquals(validateRecordPayload(input), null, `unexpectedly accepted field ${field}`);
  }
});

Deno.test("record envelope rejects unsafe revisions and malformed nonce/ciphertext", () => {
  assertEquals(validateRecordPayload({ ...validRecord(), revision: 0 }), null);
  assertEquals(validateRecordPayload({ ...validRecord(), revision: 1.5 }), null);
  assertEquals(validateRecordPayload({ ...validRecord(), revision: Number.MAX_SAFE_INTEGER + 1 }), null);
  assertEquals(validateRecordPayload({ ...validRecord(), payload_nonce: "N".repeat(15) }), null);
  assertEquals(validateRecordPayload({ ...validRecord(), ciphertext: "A".repeat(21) }), null);
  assertEquals(validateRecordPayload({ ...validRecord(), ciphertext: "A".repeat(25) + "=" }), null);
  assertEquals(
    validateRecordPayload({ ...validRecord(), ciphertext: "A".repeat(MAX_CIPHERTEXT_B64URL_CHARS + 1) }),
    null,
  );
});

Deno.test("pagination and record revision parameters are bounded and unambiguous", () => {
  assertEquals(parsePagination(new URL("https://example.test/vaults?limit=50&offset=100")), { limit: 50, offset: 100 });
  assertEquals(parsePagination(new URL("https://example.test/vaults?limit=101")), null);
  assertEquals(parsePagination(new URL("https://example.test/vaults?limit=5&offset=-1")), null);
  assertEquals(parseOptionalRevision(new URL("https://example.test/record?revision=4")), 4);
  assertEquals(parseOptionalRevision(new URL("https://example.test/record?revision=0")), null);
  assertEquals(parseOptionalRevision(new URL("https://example.test/record?revision=1&revision=2")), null);
});

Deno.test("API authenticates with Supabase Auth and never decrypts server-side", async () => {
  const api = await Deno.readTextFile(new URL("../aria-private-vault-v1/index.ts", import.meta.url));
  assertStringIncludes(api, "identityClient.auth.getUser(bearer)");
  assertStringIncludes(api, "aria_vault_consume_rate_limit_v1");
  assertStringIncludes(api, "aria_vault_audit_events");
  assertStringIncludes(api, '.eq("owner_id", ownerId)');
  assertStringIncludes(api, "cache-control");
  assert(!api.includes("crypto.subtle.decrypt"), "API must not decrypt private payloads");
  assert(!api.includes("request.text()"), "API must use bounded request parsing");
  assert(!api.includes('access-control-allow-origin", "*"'), "API must not use wildcard credentialed CORS");
});

Deno.test("migration keeps direct client roles out and locks down rate-limit RPC", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20261016150000_aria_private_vault_v1.sql", import.meta.url));
  for (const table of ["aria_vault_vaults", "aria_vault_records", "aria_vault_audit_events", "aria_vault_rate_windows"]) {
    assertStringIncludes(sql, `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    assertStringIncludes(sql, `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
  }
  assertStringIncludes(sql, "SET search_path = ''");
  assertStringIncludes(sql, "REVOKE ALL ON FUNCTION public.aria_vault_consume_rate_limit_v1(uuid, text) FROM PUBLIC, anon, authenticated");
  assertStringIncludes(sql, "GRANT EXECUTE ON FUNCTION public.aria_vault_consume_rate_limit_v1(uuid, text) TO service_role");
});


Deno.test("rate-limit RPC rejects null action and keeps execution server-only", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20261016150000_aria_private_vault_v1.sql", import.meta.url));
  assertStringIncludes(sql, "IF p_owner_id IS NULL OR p_action IS NULL OR p_action NOT IN");
  assertStringIncludes(sql, "REVOKE ALL ON FUNCTION public.aria_vault_consume_rate_limit_v1(uuid, text) FROM PUBLIC, anon, authenticated, service_role;");
  assertStringIncludes(sql, "GRANT EXECUTE ON FUNCTION public.aria_vault_consume_rate_limit_v1(uuid, text) TO service_role;");
});


Deno.test("vault routes through the existing authenticated API without an extra Edge Function", async () => {
  const api = await Deno.readTextFile(new URL("../aria-app-api-v3/index.ts", import.meta.url));
  const embedded = await Deno.readTextFile(new URL("../aria-app-api-v3/private-vault.ts", import.meta.url));
  assertStringIncludes(api, 'import { handlePrivateVaultRequest, isPrivateVaultRoute, privateVaultAuthFailure, privateVaultPreflight } from "./private-vault.ts";');
  assertStringIncludes(api, 'if (req.method === "OPTIONS" && isPrivateVaultRoute(internalPath))');
  assertStringIncludes(api, 'return privateVaultAuthFailure(req.headers.get("origin"), status, errorCode, crypto.randomUUID());');
  assertStringIncludes(api, 'handlePrivateVaultRequest(req, String(user.id), crypto.randomUUID(), serviceClient())');
  assertStringIncludes(embedded, 'const FUNCTION_SLUG = "private-vault";');
  assertStringIncludes(embedded, 'return path.includes("/private-vault/") || path.endsWith("/private-vault");');
  assertStringIncludes(embedded, "export function privateVaultAuthFailure");
  assertStringIncludes(embedded, '.eq("owner_id", ownerId)');
  assertStringIncludes(embedded, "aria_vault_consume_rate_limit_v1");
  assertStringIncludes(embedded, 'admin.rpc("aria_vault_append_record_revision_v1", {');
  assert(!embedded.includes('.from("aria_vault_records")\n      .insert('), "record inserts must go through the atomic revision RPC");
  assertStringIncludes(embedded, "aria_vault_audit_events");
  assert(!embedded.includes('access-control-allow-origin", "*"'), "private vault must not use wildcard CORS");
  assert(!embedded.includes("Deno.serve"), "embedded helper must not start a second server");
});


Deno.test("atomic revision migration serializes each record and preserves rollout compatibility", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20261023033629_aria_encrypt_atomic_record_revisions.sql", import.meta.url));
  assertStringIncludes(sql, "pg_catalog.pg_advisory_xact_lock");
  assertStringIncludes(sql, "pg_catalog.max(r.revision)");
  assertStringIncludes(sql, "p_revision <> v_expected_revision");
  assertStringIncludes(sql, "ERRCODE = '40001'");
  assert(!sql.includes("REVOKE INSERT ON TABLE public.aria_vault_records FROM service_role"), "do not break the old LIVE API before the RPC route is deployed");
  assertStringIncludes(sql, "REVOKE ALL ON FUNCTION public.aria_vault_append_record_revision_v1");
  assertStringIncludes(sql, "GRANT EXECUTE ON FUNCTION public.aria_vault_append_record_revision_v1");
});


Deno.test("API reports unknown operation outcome if audit finalization fails", async () => {
  const admin = {
    rpc: async () => ({ data: { allowed: true, retry_after_seconds: 60 }, error: null }),
    from: (table: string) => {
      assertEquals(table, "aria_vault_audit_events");
      return {
        insert: (_row: unknown) => ({
          select: (_columns: string) => ({
            single: async () => ({ data: { id: RECORD_ID }, error: null }),
          }),
        }),
        update: (_row: unknown) => ({
          eq: (_column: string, _value: string) => ({
            eq: async (_ownerColumn: string, _ownerId: string) => ({
              error: { code: "AUDIT_FINALIZE_TEST_FAILURE" },
            }),
          }),
        }),
      };
    },
  } as any;

  const response = await handlePrivateVaultRequest(
    new Request("https://example.test/functions/v1/aria-app-api-v3/private-vault/not-a-route"),
    VAULT_ID,
    RECORD_ID,
    admin,
  );
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "audit_finalize_failed", operation_result: "unknown" });
});


Deno.test("post-rollout privilege migration revokes direct service_role INSERT only after RPC rollout", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20261023034057_aria_encrypt_revoke_direct_record_insert.sql", import.meta.url));
  assertStringIncludes(sql, "REVOKE INSERT ON TABLE public.aria_vault_records FROM service_role");
  assertStringIncludes(sql, "aria_vault_append_record_revision_v1");
});
