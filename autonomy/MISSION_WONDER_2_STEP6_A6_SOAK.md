# Mission Wonder 2 — Step 6 / A6: Continuity and soak

**Status at branch start:** PREPARATION ONLY — no live soak started; no A6 production scope exists.

## Purpose

A6 is the continuity/soak certification after A4 ordinary PWA mission execution and A5 same-job recovery. It must show that several successive missions remain observable, verifiable and recoverable over a sustained window—not merely that one mission succeeded once.

The master roadmap proposes an initial **24-hour** window and an optional reinforced **72-hour** window. This branch codifies a proposed minimum of **5 independently verified missions per 24 hours** (15 for 72 hours). Those volume figures are operational proposals for review, not historical evidence or a completed run.

## Required evidence

1. Mission and job identity: each mission/job ID is unique; every mission ends in `succeeded`; an independent objective verifier confirms the result exactly once. Each mission must carry a source-derived completion timestamp inside the soak window; completions must be unique, span at least the declared minimum fraction of the window, and remain within the declared maximum intermission.
2. Artifacts: every mission has exactly one valid SHA-256 hash, all hashes are unique, `duplicateCount` is explicitly zero, and the mission is inactive at close.
3. Worker continuity: normal heartbeat gaps remain within the declared threshold; expected outage gaps are explicitly recorded and recover within the declared recovery limit. A coverage summary must account for the full window, with expected/observed intervals and zero unexplained missing intervals.
4. Fault matrix: one controlled, observed and recovered scenario for each of host restart, provider degradation, executor offline, timeout and rate limiting.
5. Bounded execution: each job stays within the declared attempt limit (maximum three); telemetry includes at least one latency and cost sample per mission; independently measured orphan jobs and executor processes are both zero; every backlog sample is valid and the queue returns to zero at the end.
6. Performance and economics: record p50/p95 latency, total cost and average cost per mission. The LIVE run must declare an explicit p95 latency ceiling and total cost cap before starting; missing thresholds block PASS.

7. Ambient isolation: capture before/after fingerprints for every non-A6 nonterminal mission and non-A6 active job; require exact equality. Preserve the global mission freeze and keep cron jobs 48/49/50 disabled in both snapshots. This prevents the soak from silently draining, resuming or changing the historical backlog.

## Proposed acceptance baseline

- Duration: 24 hours initial; 72 hours reinforced.
- Volume: at least 5 independently verified missions in 24 hours; 15 in 72 hours.
- Heartbeat: normal gap no greater than the configured maximum (initial design target: 3 heartbeat intervals); any expected outage must be detected and recovered inside the declared recovery SLA.
- Correctness: 100% of the soak missions independently verified; exactly one `mission_verified` event per mission. Mission completion timestamps must span at least the declared `minimumMissionSpanRatio` of the window; every intermission gap must remain under `maxMissionIntermissionMs`.
- Heartbeat coverage: the independent reconciler must account for the full window using observed intervals plus explicitly attributable outage intervals; unexplained missing intervals must equal zero.
- Reliability: zero duplicate mission IDs, job IDs, artifact hashes, zero orphan jobs and zero orphan executor processes.
- Recovery: all five fault scenarios detected and recovered; no job exceeds three attempts.
- Queue: zero pending jobs at close; oldest pending age must remain under the declared ceiling.
- Cost/latency: thresholds declared before the LIVE soak; no guessed or post-hoc thresholds.

## Implementation in this preparation slice

- Adds a pure A6 evidence evaluator and deterministic regression tests.
- Adds the evaluator to `npm test`.
- Does not edit the production coordinator, Supabase schema/functions, PWA, Windows agent, secrets, scheduled tasks or cron schedules.
- Preserves `MISSION_EXECUTION_PAUSED=true`; does not create missions, jobs, leases, scopes or notifications.
- The LIVE reconciler must also prove that the pre-existing non-A6 mission/job fingerprints are unchanged and that cron 48/49/50 remain disabled before and after the soak.
- The pure evaluator always labels its input UNATTESTED and cannot authenticate a claimed LIVE flag. A separate read-only reconciler must independently query the authoritative mission/job/event rows and hash-addressed artifacts before any LIVE certification.

## Explicit LIVE gate — not yet authorized or prepared for dispatch

Before a production soak can start, a separate exact-SHA workflow and bounded scope must be reviewed. It must bind owner, purpose, approved mission goals, allowed operation(s), worker identity, mission/job count, TTL, retry/recovery limits, cost ceiling and rollback. It must not lift the global freeze or reuse the completed A5 scope. Only a dedicated A6 scope may authorize the exact predeclared test work. The ordinary mission-create and worker-claim routes must continue returning HTTP 423 outside that scope.

The LIVE run must publish sanitized evidence with run ID, exact SHA, start/end timestamps, threshold manifest, mission/job/event/artifact hashes, heartbeat samples, fault-injection outcomes, latency/cost summaries, backlog and orphan counts, independent verification results, scope revocation and post-run HTTP 423 negative controls.

## Stop conditions

Stop and classify as BLOCKED on any duplicate, unverifiable success, stale lease accepted, recovery outside SLA, retry overflow, orphan process/job, backlog not drained, heartbeat falsely reported online, missing evidence, threshold not declared, or global-freeze negative control not returning 423. Never auto-repeat an ambiguous LIVE dispatch.

## Next valid action

Run exact-SHA CI for this preparation slice and review the generated diff. Only after CI is green should the LIVE A6 scope/workflow be designed and separately approved. The first real 24-hour soak window—not this simulated evaluator—is the point at which an extended wait is necessary.


### A6-only backlog accounting

The `a6BacklogSamples` evidence field measures only pending jobs belonging to this A6 run (`a6PendingJobs`, `oldestA6PendingAgeMs`). It must be empty at the end. It must never include or drain historical/non-A6 missions or jobs; those remain protected by the before/after count and fingerprint invariance checks.


### A6 mission marker execution bound

Each of the five idempotent marker missions carries one physical execution job and exactly one attempt. This keeps the run capped at five jobs total; a retry from the generic runner cannot generate a sixth job. Continuity/recovery is measured at the worker/dispatcher level, and each marker's fixed content makes repeated manual verification non-mutating. Any failed marker blocks the run rather than silently enqueueing another job.
