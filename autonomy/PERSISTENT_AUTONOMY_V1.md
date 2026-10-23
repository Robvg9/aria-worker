# ARIA Persistent Autonomy v1 — Supabase-independent foundation

## Objective

Provide durable, resumable mission execution without calling Supabase. The first increment is a portable Node.js control-plane library intended to run on a persistent cloud host and/or a Windows worker.

## Implemented in this increment

- \`autonomy/persistent-control-plane-v1.js\`:
  - durable JSON mission snapshots with atomic rename;
  - append-only JSONL event history;
  - mission/task state, attempts, evidence, dependency checks and progress;
  - bounded execution ticks, retries and optional replanning;
  - explicit human approval records for irreversible/high-risk actions;
  - completion is only marked \`succeeded\` after a verifier returns \`passed: true\`;
  - a polling supervisor can resume queued/running missions without chat messages.
- \`tests/persistent-control-plane-v1.test.js\`: focused contract tests for persistence, evidence, approval gates, progress and failed final verification.
- \`.github/workflows/persistent-autonomy-v1-tests.yml\`: isolated CI test job, independent of the repository's Supabase-dependent suite.

- `autonomy/persistent-http-server-v1.js` and `autonomy/persistent-dashboard-v1.html`: authenticated JSON API, polling supervisor, live mission panel, progress, task evidence, event history, and approval/rejection controls.
- `scripts/aria-persistent-autonomy-v1.js`: standalone launcher that requires an explicitly declared Supabase-independent adapter and a 32+ character control token.
- `autonomy/persistent-notifications-v1.js`: durable notification outbox with webhook delivery, retryable pending notifications, and a waiting-configuration state when no channel is authorized yet.

- `autonomy/persistent-worker-bridge-v1.js`: durable queued jobs, lease tokens, heartbeat renewal, and result reporting for a Windows worker that connects outward to the cloud coordinator.
- `scripts/aria-persistent-windows-worker-v1.js`: Windows-side poll/execute/report loop; requires a separately configured, Supabase-independent local adapter.

## Storage and deployment boundary

The JSON store is suitable as a local durable ledger and as a single-process ledger on a cloud host with a persistent disk. It is **not** a multi-writer distributed database and must not be shared concurrently by cloud and Windows processes over a network filesystem.

For a real hybrid deployment, use one authoritative cloud coordinator on a host with persistent storage, and let the Windows agent make outbound authenticated HTTPS requests to it. The Windows worker should never require an inbound public port. The first worker-claim/lease API is now implemented, including per-claim lease tokens and heartbeat renewal. The current JSON ledger is still single-process; the coordinator remains the only state writer, and the Windows agent only claims jobs and reports results through the authenticated API. No Supabase endpoint, client, secret or migration is part of this design.

## Human intervention and notifications

The runtime accepts a \`notify\` adapter. The outbox supports a user-configured HTTPS webhook (which can be backed by a notification service such as ntfy or a private Telegram relay). No external channel is contacted until its URL and any required secret are configured. Human approvals are persisted and require an explicit actor and decision; approval is not implied by a timeout.

## Safety policy

- Low/medium-risk tasks can run autonomously according to mission policy.
- High-risk and critical actions, plus any task marked \`irreversible\`, stop for explicit approval.
- No task should be described as complete without evidence.
- Failed final verification leaves the mission in \`waiting_human\`, never \`succeeded\`.
- Execution ticks are bounded by step count and runtime budget.
- Automatic retries require a task declared idempotent or an error explicitly marked retryable; interrupted non-idempotent work pauses for human review to avoid duplicating side effects.

## Test

Run with Node.js 20+:

\`\`\`powershell
node tests/persistent-control-plane-v1.test.js
\`\`\`

The isolated GitHub Actions workflow runs mission, HTTP/dashboard, worker-bridge and notification contract tests on relevant changes. A green contract test is necessary but does not prove the Windows worker, cloud host, notifications or end-to-end hybrid path are deployed.

## Not yet certified

- Actual cloud service deployment and persistent-volume configuration.
- Cloud service deployment with persistent-volume configuration and HTTPS termination.
- Provisioned, authorized planner/executor adapter with live AI-provider access.
- Windows service/autostart and live heartbeat/recovery test.
- User-selected notification integration.
- Live end-to-end mission from dashboard to PC execution and verified completion.
