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
  - a polling supervisor resumes planning, queued, and running missions without chat messages; a mission is persisted before waiting for a worker, so the dashboard can show it while the PC is offline.
- \`tests/persistent-control-plane-v1.test.js\`: focused contract tests for persistence, evidence, approval gates, progress and failed final verification.
- \`.github/workflows/persistent-autonomy-v1-tests.yml\`: isolated CI test job, independent of the repository's Supabase-dependent suite.

- `autonomy/persistent-http-server-v1.js` and `autonomy/persistent-dashboard-v1.html`: authenticated JSON API, polling supervisor, live mission panel, progress, task evidence, event history, and approval/rejection controls.
- `scripts/aria-persistent-autonomy-v1.js`: standalone local coordinator launcher for an explicitly declared Supabase-independent adapter.
- `scripts/aria-persistent-coordinator-v1.js`: hybrid cloud coordinator; persists missions first and delegates planning, execution, replanning and verification to the authenticated Windows worker.
- `autonomy/persistent-worker-coordinator-adapter-v1.js`: marker-only coordinator adapter; the cloud process does not need local model credentials.
- `autonomy/persistent-notifications-v1.js`: durable notification outbox with webhook delivery, retryable pending notifications, and a waiting-configuration state when no channel is authorized yet.

- `autonomy/persistent-worker-bridge-v1.js`: durable queued jobs, lease tokens, heartbeat renewal, and result reporting for a Windows worker that connects outward to the cloud coordinator.
- `scripts/aria-persistent-windows-worker-v1.js`: Windows-side poll/execute/report loop; performs model calls locally and makes outbound HTTPS requests only.
- `autonomy/ollama-persistent-adapter-v1.js`: local Ollama planner/verifier plus a bounded workspace adapter. It supports file listing/reading/search, backed-up file writes/edits, Git status/diff and allowlisted Node.js tests; it does not execute arbitrary shell commands.

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

## Hybrid deployment (cloud coordinator + Windows PC)

Use one cloud coordinator with a persistent disk and one or more Windows workers. The cloud ledger is single-writer: do not run multiple coordinator replicas against the same JSON directory. Put the coordinator behind HTTPS termination; the Windows worker makes outbound HTTPS requests only.

The coordinator image is packaged in \`Dockerfile.aria-coordinator\`. Build it from the repository root:

\`\`\`bash
docker build -f Dockerfile.aria-coordinator -t aria-persistent-coordinator .
\`\`\`

For a single-host setup behind a local HTTPS reverse proxy, publish the service only on loopback and mount a named persistent volume. Supply both tokens from the host's secret manager; do not commit them or paste them into chat.

\`\`\`bash
docker run -d --name aria-persistent-coordinator --restart unless-stopped \
  --publish 127.0.0.1:8787:8787 \
  --mount source=aria-missions,target=/var/lib/aria-missions \
  --env ARIA_CONTROL_HOST=0.0.0.0 \
  --env ARIA_ALLOW_REMOTE_BIND=true \
  --env ARIA_CONTROL_HTTPS_TERMINATED=true \
  --env ARIA_CONTROL_TOKEN \
  --env ARIA_WORKER_TOKEN \
  aria-persistent-coordinator
\`\`\`

This local port binding is not a public HTTPS deployment by itself. For a cloud host, attach its persistent disk at \`/var/lib/aria-missions\` and confirm HTTPS termination before enabling remote bind.

Cloud coordinator environment (keep both tokens secret and different):

\`\`\`bash
export ARIA_MISSION_DATA_DIR=/var/lib/aria-missions
export ARIA_CONTROL_HOST=0.0.0.0
export ARIA_CONTROL_PORT=8787
export ARIA_CONTROL_TOKEN="<random-secret-at-least-32-characters>"
export ARIA_WORKER_TOKEN="<different-random-secret-at-least-32-characters>"
export ARIA_ALLOW_REMOTE_BIND=true
export ARIA_CONTROL_HTTPS_TERMINATED=true
node scripts/aria-persistent-coordinator-v1.js
\`\`\`

Configure the host's persistent volume at \`D:\aria-data\` (or change the path) and HTTPS reverse proxy before exposing the service. The coordinator refuses a remote bind unless both remote-bind flags are enabled. Open the dashboard through the HTTPS URL and enter \`ARIA_CONTROL_TOKEN\`.

Windows PC environment:

\`\`\`powershell
$env:ARIA_CONTROL_URL = "https://your-private-coordinator.example"
$env:ARIA_WORKER_TOKEN = "<same-worker-token-as-coordinator>"
$env:ARIA_WORKER_ID = "robvg-windows-worker"
$env:ARIA_AUTONOMY_ADAPTER = "D:\path\to\aria-worker\autonomy\ollama-persistent-adapter-v1.js"
$env:ARIA_WORKSPACE_ROOT = "D:\path\to\approved\workspace"
$env:ARIA_OLLAMA_URL = "http://127.0.0.1:11434"
$env:ARIA_OLLAMA_MODEL = "qwen3:4b"
node scripts/aria-persistent-windows-worker-v1.js
\`\`\`

The PowerShell supervisor script `scripts/Start-ARIA-Persistent-Worker.ps1` loads an external private config and restarts the Node worker with bounded backoff. To start it automatically after sign-in/reboot, register that script with your approved Windows startup mechanism after the cloud URL and worker token are configured; this change does not register a persistent OS task by itself.

The worker requires the configured Ollama model to be available locally. \`ARIA_WORKSPACE_ROOT\` is mandatory and is the only project tree it can read or modify. Writes and edits create backups under \`.aria-autonomy-backups\`. Credentials, \`.env\` files, \`.git\`, \`node_modules\`, and Supabase paths are excluded. Arbitrary shell commands, commits, pushes and deployments are not exposed by this adapter.

If the worker is offline when a mission is submitted, the mission is saved in \`planning\` state first. It remains visible and the durable planning job is reused when the worker reconnects; no chat message such as “continue” is needed. The current webhook notification outbox is durable; push delivery still requires a configured HTTPS webhook.

## Local-only test mode

For isolated testing, run \`scripts/aria-persistent-autonomy-v1.js\` with a local adapter that exports \`supabaseIndependent: true\`, \`plan\`, \`executeTask\` and \`verifyCompletion\`, and a control token of at least 32 characters. Do not point it at the live project workspace until you have reviewed the current working tree and selected the exact workspace.

## Tests

Run with Node.js 20+:

\`\`\`powershell
node tests/persistent-control-plane-v1.test.js
node tests/persistent-http-server-v1.test.js
node tests/persistent-worker-bridge-v1.test.js
node tests/persistent-notifications-v1.test.js
node tests/ollama-persistent-adapter-v1.test.js
node tests/persistent-hybrid-e2e-v1.test.js
\`\`\`

The isolated GitHub Actions workflow runs the mission, HTTP/dashboard, worker-bridge, notification, Ollama-adapter and simulated hybrid end-to-end contract tests on relevant pull-request changes. A green contract test is necessary but does not prove the Windows worker, cloud host, notifications or end-to-end hybrid path are deployed.
