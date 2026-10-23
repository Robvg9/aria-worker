# ARIA Mission Twin + Bounded Self-Improvement v1 — Design Contract

Status: **design proposal; not implemented by this document**  
Tracking: [Issue #1309](https://github.com/Robvg9/aria-worker/issues/1309)  
Related stabilization work: [Issue #1305](https://github.com/Robvg9/aria-worker/issues/1305)

## 1. Existing architecture evidence

Inspected repository files on 2026-10-23:

- `wrangler.toml` declares `[triggers].crons = ["* * * * *"]`.
- `worker.js` exports a Cloudflare `scheduled` handler that calls `runScheduledMission(env)`. The function POSTs an empty JSON body to `aria-canonical-runtime-v1` with `x-aria-trigger: scheduler`.
- `supabase/functions/aria-canonical-runtime-v1/index.ts` treats `scheduler` and `mission-tick` as asynchronous dispatches to `aria-mission-runner-v22` and returns HTTP 202 when accepted.
- `supabase/functions/aria-mission-runner-v22/index.ts` has mission lease/recovery and execution logic. With no `mission_id`, it calls `aria_mission_claim_next_lease` and returns `idle` when no mission is available; otherwise it claims and executes the next mission. Thus the existing cron is a regular queue-worker trigger, not evidence that a self-improvement cycle is being launched. Do not insert self-improvement directly into this hot path without a separate due-time/lease gate and explicit isolation from normal mission processing.
- `autonomy/continuous-self-improvement-v1.js` defines 13 injected stages. `maxCycles` defaults to 1 and is bounded to 1–10.
- `autonomy/continuous-self-improvement-contract-v1.md` explicitly says that loop has no timer, network, credential, or persistence authority.
- `autonomy/canonical-runtime.js` composes the governed mission runtime and cognitive memory/loop, but the inspected version does not compose the continuous self-improvement pipeline.
- `.github/workflows/continuous-self-improvement-v1-live.yml` is a push/manual contract workflow, not the recurring scheduler.

These facts establish configured source behavior only. They do **not** prove that production is running the current SHA, that every scheduled tick succeeds, or that self-improvement runs unattended today.

## 2. Objective

Reuse existing ARIA authorities to implement a safe feedback loop:

**Observe → Recall → Propose → Simulate → Score → Authorize → Execute (if allowed) → Verify → Learn → Record**

Every nominal 10-minute evaluation asks:

> What is the smallest useful, evidence-backed improvement I can make now?

The system may legitimately conclude **NO_ACTION**. It must never invent changes merely to look productive.

## 3. Component boundaries

### Scheduler adapter
- Reuse the existing Cloudflare Cron Trigger as the wake-up source; do not add a second independent scheduler without evidence it is needed.
- The Worker cron currently fires every minute. The self-improvement cadence should be governed by durable due-time state (default 10 minutes), not by running the full improvement pipeline on every minute tick.
- Each wake-up should perform only a bounded, cheap due/lease check before dispatching work.
- A scheduler event is a trigger, not proof that the job ran or succeeded.

### Durable cycle coordinator
- Claim a single cycle atomically using a durable lease/idempotency key.
- Persist cycle ID, due time, lease owner/expiry, attempt number, checkpoint, candidate ID, status, timestamps, and bounded diagnostic evidence.
- On restart, resume from a safe checkpoint or mark the prior cycle interrupted; never blindly replay a non-idempotent side effect.
- A competing tick must return an explicit already-running/not-due result rather than duplicate work.

### Mission Twin (read-only first)
Input: mission/run snapshots, dependencies, preconditions, policy constraints, failure evidence, and available resource limits.

Output:
- dependency graph and missing prerequisites;
- predicted blockers with confidence and source evidence;
- alternative plans and counterfactual trade-offs;
- expected impact, estimated cost, risk, reversibility, and rollback;
- explicit unknowns and stale evidence;
- recommendation: proceed in sandbox, ask for approval, defer, or no action.

Simulation output must be labelled **SIMULATED**, never LIVE/PASS. Unknown evidence must remain unknown.

### Candidate evaluator
Score candidates with transparent factors:
- expected benefit and number of missions unblocked;
- evidence confidence and freshness;
- cost and duration;
- security/permission risk;
- reversibility and testability;
- overlap with active missions and existing fixes.

Choose at most one small candidate per cycle. Prefer eliminating a repeated shared failure over adding a large new capability.

### Governed executor
- Default mode: read-only discovery and recommendation.
- A low-risk code change may be attempted only in an isolated branch/sandbox when existing policy explicitly permits it.
- Route execution through the existing planner, authorization fence, executor, verifier, learning and rollback authorities; do not create bypasses or a parallel source of execution authority.
- Human approval remains mandatory for production deployment, credentials/secrets, permissions, destructive data changes, external spending, and other sensitive actions.
- Never allow the loop to modify its own policy, permissions, kill switch, or safety tests.

### Evidence ledger
For every cycle, persist:
- trigger/cycle ID, start/end time, runtime/build identity;
- observations and referenced source evidence;
- candidate, score and alternatives considered;
- authorization decision and policy version;
- actions attempted, tests and verifier evidence;
- actual vs expected result, cost/duration, terminal status;
- reason for NO_ACTION, BLOCKED, FAILED or deferred status;
- lesson proposed and whether it was accepted.

Do not persist secrets, access tokens, or unnecessary sensitive payloads.

## 4. Safety limits

Initial operating mode is read-only and recommendation-only. Enable isolated low-risk execution only after contract tests and explicit policy configuration pass.

Required controls:
- default cadence 10 minutes; configuration must enforce a safe lower bound and upper bound;
- one active cycle at a time; durable lease and idempotency key;
- bounded wall-clock time, candidate count, retries, model/tool spend, and concurrent jobs;
- exponential backoff/cooldown for repeated failures;
- circuit breaker for repeated errors, stale evidence, missing configuration, or unavailable verification;
- global kill switch checked before every mutation and before promotion;
- cancellation propagated to child work;
- fail closed on malformed, missing, contradictory or unknown verification results;
- no promotion when tests fail or are skipped;
- reversible changes with snapshots/rollback before mutation;
- a maximum number of autonomous changes per time window;
- a durable audit record for every action and no-action decision.

## 5. Proposed state machine

`DUE → CLAIMED → OBSERVING → SIMULATING → CANDIDATE_SELECTED | NO_ACTION → AUTHORIZATION_CHECK → SANDBOX_EXECUTION → VERIFYING → LEARNING → COMPLETED`

Terminal/non-success states: `BLOCKED`, `FAILED`, `CANCELLED`, `INTERRUPTED`.

Rules:
1. A missing lease, invalid policy, stale evidence, or failed authorization blocks execution.
2. `NO_ACTION` is a valid successful evaluation, not an error.
3. A failed or blocked verifier prevents promotion and learning a success.
4. Recovery resumes only from a checkpoint proven safe for that stage.
5. Every transition is auditable and idempotent.

## 6. Implementation sequence

1. Complete read-only inventory and trace the existing scheduled empty-body request through the canonical runtime and mission runner.
2. Confirm the current live Worker SHA and obtain scheduler-run evidence without changing production.
3. Define and test the pure Mission Twin contract with synthetic fixtures and explicit unknowns.
4. Define the durable cycle record and lease/idempotency contract using existing supported persistence/queue authorities.
5. Integrate the due-time check with the existing cron wake-up only after confirming the canonical route does not conflict with ordinary mission recovery.
6. Add the bounded coordinator in recommendation-only mode.
7. Add tests for clock boundaries, overlapping ticks, lease expiry, duplicate prevention, restart recovery, stale evidence, cancellation, budgets, kill switch and fail-closed verification.
8. Add isolated low-risk execution behind explicit policy; retain human approval for sensitive changes.
9. Validate existing mandatory test and Phase 6 inventory gates without weakening them.
10. Enable only after review and evidence. No production deployment is implied by completing this document.

## 7. Verification matrix

| Claim | Required evidence |
|---|---|
| A cron is configured in source | `wrangler.toml` and Worker handler inspection |
| Production runs the intended SHA | authoritative deployment metadata for the exact SHA |
| Cron ticks are delivered | timestamped scheduler run evidence |
| A cycle is durable | restart/lease recovery tests and persisted cycle records |
| The cadence is 10 minutes | due-time logic tests and timestamped observations |
| A Mission Twin prediction is valid | synthetic fixture tests and source references |
| A change is safe | authorization result, isolated test output, independent verification |
| A change is deployed | separate approved deployment evidence |
| A mission succeeded | terminal runtime evidence; never infer from acceptance/HTTP 202 alone |

## 8. Explicit constraints

- Do not call Supabase production APIs, alter production queues/data, inspect secrets, or deploy while account access is restricted. Wait for explicit restoration confirmation or the agreed 2026-10-27 cutoff.
- Validate PR #1304 before touching related retry behavior in issue #1305.
- Do not merge untested implementation.
- This document is a design contract, not evidence that the scheduler, Mission Twin, or unattended self-improvement is already implemented.
