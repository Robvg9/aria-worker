# Recovery v3 – Mission Wonder 2 – Step 4 (A4)

## Overview

The A4 recovery flow has been hardened to **v3** with the following improvements:

1. **Explicit parent‑object construction** – the `a4_recovery_dispatch_v1` JSONB object is built explicitly using `jsonb_build_object` and merged with any existing metadata. This eliminates the silent no‑op when the parent key is missing.
2. **Atomic grant update** – `granted`, `granted_at` and `grant_ref` are written in a single `UPDATE` with a row‑count guard.
3. **In‑transaction verification** – after the grant update the RPC re‑reads the metadata; any mismatch raises an exception and rolls back the whole call (including the scope re‑arm).
4. **Dispatch token claim** – the claim RPC atomically flips `consumed` and verifies the persisted reservation before returning.
5. **Strict acceptance logic** – the controlled‑recovery workflow now checks:
   * `action` must be `recovered` (or `already_recovered`).
   * `dispatch_reservation_granted` **true**.
   * `dispatch_reservation_persisted` **true**.
   * `dispatch_reservation_preexisting` **false**.
   * The `dispatch_grant_ref` returned by the RPC must exactly match the generated `GRANT_REF`.
6. **Pre‑SQL validation** – `scope_id` and `goal_hash` are validated with regexes **before** any interpolated SQL is built, preventing injection or malformed identifiers.
7. **Real‑PostgreSQL integration test** – `tests/mission-wonder-2-step4-a4-recovery-pg-integration.test.mjs` now runs 10 scenarios (including sabotage‑trigger rollback) against a real PostgreSQL service in CI, asserting actual persisted state.

All changes are contained in PR #1429 and the CI run on SHA `e92f92332c42e0eb58ba754b43dd1026763fc528` passes **27/27** checks.

---

*This file is part of the PR documentation and is referenced in the PR description.*