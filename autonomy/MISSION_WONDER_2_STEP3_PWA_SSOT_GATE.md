# Mission Wonder 2 — Step 3 / A4: PWA ordinary mission SSOT gate

Status: **IN PROGRESS — architecture/contract gate only**  
Base: `main` at `6803b5cc41bcd2d519a82c66f2e5156458420976`  
Mission status carried forward: Step 1/10 CLOSED; Step 2/10 CLOSED / PASS. This document does not reopen either step.

## Objective

Prepare the next real autonomy proof: an ordinary, user-authored mission submitted from the PWA, not a Package 3 fixture or a preconstructed Durable Object probe. The acceptance path is:

`PWA create → authenticated intake → goal admission/compile → plan → canonical queue → claim/lease → execute → progress → artifact → independent objective verification → honest terminal state → PWA notification → open mission detail`.

The broader Mission Wonder 2 checklist calls this **A4 — Misión ordinaria real E2E**. A4 is not closed by a source-level contract, CI, a planner preview, or the older synthetic Package 3 probe.

## Source audit at the base SHA

### PWA / canonical application path

- `pwa/src/ProjectWorkspace.tsx` submits an ordinary mission through `POST /missions`, sends `x-aria-request-id`, and preserves the same request identity across an uncertain retry.
- The same PWA reads project mission lists through `GET /projects/:projectId/missions` and opens details through `GET /missions/:missionId`.
- `supabase/functions/aria-app-api-v3/index.ts` reads canonical mission records from `aria_internal.mission_state`, performs owner-scoped request-ID readback before retrying intake, and delegates mission intake to `aria-direct-v1`.
- The app API, DIRECT, mission-intake, and canonical-runtime paths currently retain `MISSION_EXECUTION_PAUSED = true`; the app API rejects mission mutation with HTTP 423 before its POST `/missions` handler. DIRECT, intake, and canonical runtime also fail closed.
- Therefore, the ordinary PWA create path is intentionally unavailable while the global freeze remains active. This is a safety property, not evidence of a broken deployment.

### Separate Cloudflare coordinator path

- `cloudflare-autonomy/worker.mjs` explicitly describes itself as a Supabase-independent coordinator whose Durable Object storage is its own source of truth.
- Its `/api/missions` route stores missions under `mission:<id>` in Durable Object storage. It also owns its jobs, events, leases, and notifications.
- Its remote planner bridge can call the canonical Supabase planner, but that does not make the Durable Object mission record the same record as `aria_internal.mission_state`.
- The current PWA project list/detail routes read Supabase `mission_state`; they do not read Durable Object `mission:<id>` records.
- `POST /api/plan-preview` is explicitly non-mutating while the freeze is active. Its existing contract test asserts `durable_state_mutated=false` and zero Durable Object records. It proves planning preview only, not an ordinary PWA mission.

## Architecture decision required before live integration

**Recommended source-of-truth rule: keep Supabase `aria_internal.mission_state` as the canonical user-facing mission identity for the current PWA.** The PWA's ownership filters, idempotent request-ID recovery, mission detail, event history, and notification flow already depend on that identity.

The Cloudflare coordinator must not independently create a second user-visible mission for the same PWA request. A future integration must choose and implement one of these coherent models:

1. Keep Supabase canonical and adapt Cloudflare as a bounded coordinator/executor over canonical mission and job identifiers, with explicit ownership, idempotency, lease fencing, event/evidence handoff, and reconciliation; or
2. Deliberately migrate the PWA's complete create/list/detail/events/notification authority to Cloudflare, with a reviewed migration and no parallel Supabase mission creation.

Do not implement a half-bridge that creates in both stores, invents a second mission ID, or reports a Durable Object mission as visible before the canonical PWA readback can retrieve it. Option 1 is the recommended minimum-change route, subject to a tested contract for the canonical job/lease boundary.

## Gates for the real A4 proof

Before any live ordinary mission is permitted:

1. Document and test the one authoritative mission identity and its ownership boundary end to end.
2. Prove an idempotent PWA retry returns the same canonical mission and cannot create a second record.
3. Prove planner output is bound to that same mission, operations are allowlisted, and unsafe/mutating work reaches a human approval gate.
4. Prove canonical jobs, leases, progress, artifacts, verifier results, and notifications are all traceable to that mission.
5. Prove a read-only preflight and rollback path while the global freeze remains active.
6. Only after a separate explicit live gate, run one user-authored, bounded mission with a supplied real goal. Verify the complete path and read the result back through the PWA. A successful HTTP acknowledgement alone is insufficient.

The future A4 evidence package must include the source SHA, mission/request/trace IDs, event sequence, job and attempt IDs, lease fencing evidence, artifact hashes, independent verifier result, notification delivery/readback, and the exact PWA detail readback. Do not expose credentials or sensitive payloads in the artifact.

## Explicitly outside this change

- Do not change or unset any `MISSION_EXECUTION_PAUSED` guard.
- Do not deploy either mission runtime or run a live mission.
- Do not enable the ARIA Scheduled Task or crons #48/#49/#50.
- Do not write Supabase data, migrations, or secrets.
- Do not send Telegram messages or invoke local Ollama/Qwen on ROBVG.
- Do not modify BattleCruiser or its runner.
- Do not mark Step 3/A4 closed on the strength of this contract.

This PR adds documentation and a source-contract regression test only. Its CI result is not a live autonomy certification.
