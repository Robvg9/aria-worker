# ARIA remote-service circuit breaker — local + distributed

## Purpose

Stop repetitive Supabase gateway requests after HTTP 402 without enabling mission execution, billing changes, provider probes, or automatic recovery.

## Local circuit

Windows and Termux persist local state at
`~/.aria/state/remote-service-circuit.json` by default. Set
`ARIA_AGENT_STATE_DIR` to override the directory.

- HTTP 402 opens a persistent circuit on that installation.
- The provider reason is classified only when the response body explicitly supports it; otherwise it remains `unknown_402`.
- HTTP 423 with `mission_execution_paused` pauses only the affected claim route.
- The local heartbeat file/health observation continues; the remote gateway is not polled while a local 402 circuit is open.
- 408, 429 and 5xx retain bounded retries and honor `Retry-After.
- Corrupt/unwritable circuit state fails closed.
- Local persistence is per host/profile, not a cross-device coordinator.

## Distributed circuit — independent Durable Object

When the coordinator connection is configured, each agent also uses the existing Supabase-independent ARIA Autonomy Coordinator:
`https://aria-autonomy-coordinator.robvg9.workers.dev/api/worker/service-circuit`.

Required agent environment:
- `ARIA_AUTONOMY_WORKER_TOKEN` (or an existing `ARIA_WORKER_TOKEN` already used by that coordinator worker).
- Optional `ARIA_AUTONOMY_COORDINATOR_URL`; default is the URL above.
- `ARIA_DEVICE_ID` is preferred for stable installation identity; only its SHA-256 hash is sent.

Behavior:
1. The first local 402 is persisted locally and reported once to the independent coordinator using only an allow-listed classification, allow-listed route, agent family, timestamp, random incident ID and SHA-256 installation identifier. Response bodies, prompts, credentials and raw device IDs are never sent.
2. The coordinator stores one global open incident in the existing Durable Object. It does not use Supabase.
3. The first global open creates one deduplicated notification through the coordinator's existing Telegram delivery path. Later devices/observations update counters but do not send duplicate alerts for the same incident.
4. Windows and Termux query the coordinator on a throttled interval (`ARIA_CIRCUIT_SYNC_INTERVAL_MS`, default 30 seconds). An open global incident is written to each installation's local circuit. The agents stop Supabase gateway requests while the circuit is open.
5. If the coordinator is unavailable or not configured, the local circuit still blocks after that installation observes HTTP 402; distributed propagation is unavailable, but no new Supabase retry loop is introduced.

The coordinator's worker route is authenticated with its worker token and works while the mission freeze is active only for this narrow control record. It cannot create missions, jobs, tasks, or leases.

## Manual recovery — owner only

The global reset endpoint is:
`POST /api/ops/service-circuit/reset`.

It requires the coordinator control token and all of:
- `confirm = RESET_GATEWAY_402_CIRCUIT_ONCE`
- `service_restored = true` (owner attestation)
- a non-empty evidence reference
- an operator note

The owner must verify service restoration independently before submitting the reset. This is an owner Human Gate, not an automatic health probe. The reset clears only the matching global 402 circuit. It does not clear 423 route pauses and does not change
`MISSION_EXECUTION_PAUSED=true`.

Agents apply the reset only when its incident ID matches their recorded global incident. A purely local 402 circuit that was never confirmed by the coordinator is not cleared by an unrelated global reset.

## Telegram alert

- Uses the coordinator's existing server-only `ARIA_TELEGRAM_BOT_TOKEN` and `ARIA_TELEGRAM_CHAT_ID` secrets.
- Alert key includes the global incident ID; only the first open sends one message.
- If Telegram is not configured or transport fails, the notification remains in the coordinator's durable notification state; no automatic agent retry loop is added.
- No bot token or chat ID is sent to Windows/Termux.

## Boundaries

- No Supabase/Cloudflare AI inference, fallback provider, or quota probe.
- No billing/plan changes or credential reads.
- No Cloudflare Worker deployment occurs from this feature branch; the coordinator update requires its separate reviewed deployment workflow.
- No mission, lease, job, cron or scheduled task is started.
- No automatic reset and no global mission unfreeze.

The distributed feature is not active on physical agents until the reviewed coordinator version is deployed and both agent environments are provisioned with the already-authorized coordinator worker token. Until then, local circuit protection remains active.
