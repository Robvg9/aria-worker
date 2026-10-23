# ARIA Private Vault v1 — API and storage contract

Status (2026-10-20): Steps 1–5 have been merged and the private-vault route is live inside `aria-app-api-v3`. A read-only LIVE review found one vault, one ciphertext record, 313 terminal audit events and working server-side owner-scoped routes. Full acceptance remains OPEN pending integrity hardening and authenticated two-owner isolation. Do not migrate historical personal content until all acceptance gates pass.

## Security boundary

The browser encrypts the complete private record before sending it. The Edge Function receives only opaque IDs, version metadata, KDF salt/parameters, encrypted key wrappers, a random AES-GCM nonce and ciphertext. It never receives the vault password, recovery key, unwrapped vault key or plaintext. There is deliberately **no server-side unlock endpoint**: a wrong vault password fails locally during authenticated decryption, so the server has nothing to log or compare.

Authentication (Supabase account JWT) is distinct from vault unlock. An authenticated owner may download their ciphertext while their local vault is locked, but cannot decrypt it without the client-side key. This is intentional zero-knowledge storage behavior, not a claim that the API enforces the UI's lock state.

## Storage

Migration: `supabase/migrations/20261016150000_aria_private_vault_v1.sql`

- `public.aria_vault_vaults`: owner/vault IDs, fixed Argon2id profile, salt and separately encrypted password/recovery wrappers for the root key.
- `public.aria_vault_records`: append-only record revisions with opaque IDs, revision, nonce and ciphertext. No title/body/plaintext columns. Duplicate revisions conflict instead of overwrite.
- `public.aria_vault_audit_events`: owner, action, outcome, resource ID, HTTP status, request ID and timestamp only. Request bodies, ciphertext, passwords and keys are never audit fields.
- `public.aria_vault_rate_windows`: one atomic per-owner/per-action minute bucket.

RLS is enabled on every table; no direct client-role policies are created. Table privileges are revoked from PUBLIC, anon and authenticated. The Edge Function accesses the tables only using its server-side service-role credential after validating the caller JWT using Supabase Auth and derives owner identity exclusively from the verified user, never the body/path.

The rate-limit RPC is SECURITY DEFINER only for the atomic bucket transaction, has an empty search_path, qualifies its objects, rejects unknown actions, and has EXECUTE revoked from PUBLIC/anon/authenticated. Only service_role may execute it. Limits are 120 reads/minute, 30 record writes/minute and 12 vault-config changes/minute per owner/action. A fixed UTC/database-minute window is used; clients receive 429 plus Retry-After.

## API routes

Route module: `supabase/functions/aria-app-api-v3/private-vault.ts`, mounted at `aria-app-api-v3/private-vault/*` because the Supabase project reached its Edge Function limit. The existing `aria-app-api-v3` `requireUser()` verifies `Authorization: Bearer <Supabase access token>`; the handler receives the verified user ID and never accepts ownership from the body/path. Responses set `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff` and a request ID. CORS is an exact allowlist for the canonical ARIA PWA and local dev origins; CORS is not treated as authentication.

- `GET /vaults?limit=50&offset=0`: own vault configuration (includes encrypted key wrappers only), bounded pagination.
- `GET /vaults/:vaultId`: own vault configuration.
- `PUT /vaults/:vaultId`: create/update v1 KDF metadata and encrypted root-key wrappers. Client must validate unlocking/rewrapping before submitting a config update.
- `GET /vaults/:vaultId/records?limit=50&offset=0`: paginated metadata only, not ciphertext or title.
- `GET /vaults/:vaultId/records/:recordId?revision=N`: own latest or requested immutable ciphertext revision.
- `PUT /vaults/:vaultId/records/:recordId`: append a new encrypted revision. Request JSON allows exactly `format_version`, `revision`, `payload_nonce` and `ciphertext`.

No delete endpoint is provided in this step. Destructive deletion and removal of old copies must wait for backup/restore and migration controls in Step 6. No API route proxies ciphertext to ARIA, memory/retrieval, embeddings or an external model.

## Input constraints

- Format version 1 only; Argon2id v1.3 fixed at m=65536 KiB, t=3, p=4.
- Opaque UUIDv4-style IDs; KDF salt 16 bytes, AES-GCM nonce 12 bytes, wrapped 32-byte root key plus 16-byte GCM tag.
- Ciphertext-only record payload is capped at 1 MiB plaintext plus the 16-byte GCM tag (base64url representation capped at 1,398,123 characters).
- JSON body reads are streaming and bounded to 1,500,000 bytes. Schemas reject extra keys including `title`, `body`, `content`, `password`, `key`, `owner_id` and `user_id`.
- Revisions are insert-only. The first API implementation enforced uniqueness only; the proposed Step 7 hardening routes appends through a transaction-scoped lock that requires the next consecutive revision. For safe rollout, the initial RPC migration preserves the existing `service_role` INSERT grant temporarily; a separate privilege-tightening migration must revoke it only after the RPC-backed API is deployed and verified, never before. Requests do not include client-selected ownership fields.
- Errors are generic to callers. Server log output is limited to request ID and stable error code, without user content/provider messages.

## Verification supplied by this branch

- Deno contract tests cover valid/invalid payloads, unknown plaintext/ownership/key fields, KDF/nonce/ciphertext bounds, UUID, pagination, duplicate revision parameters, Auth verification, no server-side decryption, RLS and grants.
- GitHub Actions runs those contracts plus `deno check` for the Edge Function.
- Initial migration `20261016150000_aria_private_vault_v1` is applied to ARIA LIVE; the four vault tables exist with RLS enabled and no direct SELECT privileges for `anon` or `authenticated`. Read-only verification on 2026-10-23 found `aria-app-api-v3` LIVE version 345 ACTIVE. Its embedded `private-vault.ts` does **not** yet contain the Step 7 atomic append RPC, and LIVE still grants `service_role` direct INSERT/SELECT on `aria_vault_records`; this is the expected pre-rollout state, not completion of Step 7.
- LIVE audit readback on 2026-10-20 found one owner, one vault, one ciphertext record (revision 1), 313 terminal audit events and no unresolved audit rows. An earlier read-only probe passed missing-auth rejection, registered-origin CORS and denial of CORS grants to an untrusted origin; the overall workflow run failed only because its old optional issue-comment step received 403. The reporting workflow was subsequently corrected to use summary/artifact evidence, but a post-fix run has not yet been confirmed.
- The atomic revision migration `supabase/migrations/20261023040000_aria_encrypt_atomic_record_revisions.sql` is a proposal only. It has NOT been applied to LIVE. Its timestamp intentionally follows the latest registered LIVE migration (`20261023020000`) to avoid out-of-order migration history. No plaintext or ciphertext content was fetched by these metadata checks and no production writes were performed during this audit.
- The route now returns HTTP 503 with `operation_result=unknown` if the audit-finalization write errors or throws, and a focused test injects this failure. This avoids telling the client that an operation has a normal result when its audit row could remain started.
- Remaining closure gates: CI on the current hardening PR; live schema/function/privilege readback after approved merge/deploy; authenticated browser unlock + decrypt-tamper/wrong-password behavior; a second authenticated user proving tenant isolation; live duplicate/concurrent revision tests in an isolated environment; and evidence persisted back to this document. No historical plaintext migration.

## References

- Supabase Edge Function auth: https://supabase.com/docs/guides/functions/auth
- Supabase data security/RLS: https://supabase.com/docs/guides/database/secure-data
- Supabase RLS policy guidance: https://supabase.com/docs/guides/database/postgres/row-level-security
