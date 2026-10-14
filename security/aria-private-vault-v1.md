# ARIA Private Vault v1 — API and storage contract

Status: implementation prepared on `aria/encrypt-step4-vault-api`. Not deployed. Do not migrate real personal content until Step 7's live acceptance gates have passed.

## Security boundary

The browser encrypts the complete private record before sending it. The Edge Function receives only opaque IDs, version metadata, KDF salt/parameters, encrypted key wrappers, a random AES-GCM nonce and ciphertext. It never receives the vault password, recovery key, unwrapped vault key or plaintext. There is deliberately **no server-side unlock endpoint**: a wrong vault password fails locally during authenticated decryption, so the server has nothing to log or compare.

Authentication (Supabase account JWT) is distinct from vault unlock. An authenticated owner may download their ciphertext while their local vault is locked, but cannot decrypt it without the client-side key. This is intentional zero-knowledge storage behavior, not a claim that the API enforces the UI's lock state.

## Storage

Migration: `supabase/migrations/20261014155000_aria_private_vault_v1.sql`

- `public.aria_vault_vaults`: owner/vault IDs, fixed Argon2id profile, salt and separately encrypted password/recovery wrappers for the root key.
- `public.aria_vault_records`: append-only record revisions with opaque IDs, revision, nonce and ciphertext. No title/body/plaintext columns. Duplicate revisions conflict instead of overwrite.
- `public.aria_vault_audit_events`: owner, action, outcome, resource ID, HTTP status, request ID and timestamp only. Request bodies, ciphertext, passwords and keys are never audit fields.
- `public.aria_vault_rate_windows`: one atomic per-owner/per-action minute bucket.

RLS is enabled on every table; no direct client-role policies are created. Table privileges are revoked from PUBLIC, anon and authenticated. The Edge Function accesses the tables only using its server-side service-role credential after validating the caller JWT using Supabase Auth and derives owner identity exclusively from the verified user, never the body/path.

The rate-limit RPC is SECURITY DEFINER only for the atomic bucket transaction, has an empty search_path, qualifies its objects, rejects unknown actions, and has EXECUTE revoked from PUBLIC/anon/authenticated. Only service_role may execute it. Limits are 120 reads/minute, 30 record writes/minute and 12 vault-config changes/minute per owner/action. A fixed UTC/database-minute window is used; clients receive 429 plus Retry-After.

## API routes

Function: `aria-private-vault-v1`

All non-preflight routes require `Authorization: Bearer <Supabase access token>`. The handler verifies that token using `auth.getUser(token)`. Responses set `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff` and a request ID. CORS is an exact allowlist for the canonical ARIA PWA and local dev origins; CORS is not treated as authentication.

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
- Revisions are insert-only; a duplicate revision returns 409. Requests do not include client-selected ownership fields.
- Errors are generic to callers. Server log output is limited to request ID and stable error code, without user content/provider messages.

## Verification supplied by this branch

- Deno contract tests cover valid/invalid payloads, unknown plaintext/ownership/key fields, KDF/nonce/ciphertext bounds, UUID, pagination, duplicate revision parameters, Auth verification, no server-side decryption, RLS and grants.
- GitHub Actions runs those contracts plus `deno check` for the Edge Function.
- The SQL migration itself has **not** been applied to any Supabase project in this step. No Supabase live data, production schema, existing memory tables or personal content were read or changed by this implementation branch.
- Live auth/E2E, SQL execution against an isolated database, per-browser Argon2id integration, end-to-end CORS verification, service-role exposure review and deployment remain acceptance gates for Steps 5–7. The code is not live until the PR is reviewed/merged and the planned deployment/migration is explicitly performed.

## References

- Supabase Edge Function auth: https://supabase.com/docs/guides/functions/auth
- Supabase data security/RLS: https://supabase.com/docs/guides/database/secure-data
- Supabase RLS policy guidance: https://supabase.com/docs/guides/database/postgres/row-level-security
