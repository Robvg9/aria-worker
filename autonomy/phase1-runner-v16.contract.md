# ARIA Phase 1 Runner v16

Canonical runtime contract for autonomous phase-1 execution.

- Scheduler enters `aria-mission-runner-v16`.
- Mission claim uses a lease (`aria_mission_claim_next_lease`).
- Existing checkpoints resume completed steps and per-step attempt counts.
- Device jobs use deterministic job IDs for same-mission/same-step idempotency.
- Retry budget: 3 attempts per step unless `retryable=false`.
- Executor types supported by the LIVE runner: `device`, `connector` (`github`, `cloudflare`, `supabase`).
- Exhausted failures become a mission dead-letter state with audit event.
- Stale leases are reclaimed by `aria_autonomy_recover_stale_missions`.
- Secrets never travel through mission payloads; runtime secrets remain environment-bound.
