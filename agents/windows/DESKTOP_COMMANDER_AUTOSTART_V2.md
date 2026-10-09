# ARIA Windows — Desktop Commander Autonomous Startup v2

## Why v2

The earlier design used a separate Scheduled Task for Desktop Commander. A reboot test showed that this can leave ARIA with no independent control channel when Desktop Commander is unavailable.

v2 makes the existing **ARIA Windows watchdog** the bootstrap/supervisor. There is one canonical interactive autostart task:

`ARIA-Windows-Local-Agent`

That watchdog launches and supervises:

`Desktop Commander Remote`

## Runtime layout

- ARIA runtime: `D:\\ARIA-Windows-Agent\\Runtime\\windows`
- Desktop Commander fixed install: `D:\\ARIA-Windows-Agent\\Tools\\DesktopCommanderRemote`
- Desktop Commander package: `@wonderwhy-er/desktop-commander@0.2.52`
- Entrypoint: `...\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js`
- Node: resolved from `Data\\config.json` `node_path`, with fixed fallbacks `D:\\Databank\\node.exe` and `D:\\Databank\\node\\node.exe`
- DC logs: `D:\\ARIA-Windows-Agent\\Logs\\desktop-commander-*.log`

## Startup chain

Windows interactive logon
→ `ARIA-Windows-Local-Agent` Task Scheduler
→ `run-agent.ps1`
→ `Ensure-DesktopCommanderSupervisor`
→ `desktop-commander-supervisor.ps1`
→ resolved Node runtime
→ Desktop Commander Remote

No manual PowerShell is required after the one-time installation.

## Recovery

The supervisor:

1. detects an existing Desktop Commander process;
2. starts it when absent;
3. uses a named mutex to prevent duplicate supervisors;
4. retries after process exit/error;
5. keeps ARIA mission authority independent of Desktop Commander.

## Network compatibility

The Windows runtime observed an unreachable IPv6 path while direct HTTPS worked. The supervisor therefore launches Node with:

`--dns-result-order=ipv4first --no-network-family-autoselection`

This is a transport workaround, not a permission bypass.

## Security/authority

The supervisor only manages the local DC process. It does not:

- authorize ARIA missions;
- bypass Human Gate;
- alter canonical mission state;
- replace ARIA verification/evidence;
- inject provider secrets into ARIA.

Desktop Commander pairing/authentication remains a Human Gate.

## Remote-channel health reporting

A live `node.exe` proves only that a local process exists. It does not prove the hosted Remote MCP channel is subscribed or usable.

The supervisor writes separate fields in `desktop-commander-supervisor.json`:
- `process_alive`: whether a Desktop Commander process was found.
- `channel_state=last_subscribed`: the logs contain a `Channel subscribed` / `Status: Online` confirmation with no newer recognized channel error in the captured stdout tail. This is log evidence, not a live remote ping.
- `channel_state=degraded`: a recognized channel failure is newer than the latest success, or stderr shows a connection error.
- `channel_state=unverified`: a process exists but no positive subscription evidence was found.

Recognized failures include `IncreaseConnectionPool`, `Channel error`, subscription timeout, unreachable-device messages, and WebSocket 1006 closure. A log state never replaces a real remote invocation or the provider's device Online status.

## Bounded recovery for a degraded remote channel

The supervisor distinguishes known hosted transport/capacity failures from a generic local child failure.

- For `IncreaseConnectionPool`, `fetch failed` during session establishment, upstream proxy overflow, or Cloudflare 525 / SSL handshake errors, **do not restart the child automatically**. These signatures have been reported across independent hosts during Remote Desktop Commander incidents. Repeated restarts and re-authentication can create additional private-channel joins/token refreshes while the hosted pool is degraded. The supervisor keeps one client alive, reports `channel_degraded`, and rate-limits `CHANNEL_BACKEND_DEGRADED_NO_RESTART` diagnostics to once per five minutes.
- For a persistent degraded channel with no recognized hosted-failure signature, the supervisor may restart only the Desktop Commander child after 180 seconds. Automatic restarts are capped at two per rolling hour; after the cap, `CHANNEL_RESTART_LIMIT_REACHED` is logged rather than entering an unbounded loop.

Evidence / provider reports: [DesktopCommanderMCP #811](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/811), [DesktopCommanderMCP #738](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/738), [Remote Desktop Commander #32](https://github.com/desktop-commander/remote-desktop-commander/issues/32).

This is a resilience guard, not a fix for a hosted Remote MCP / Realtime backend outage. A successful HTTP preflight is not proof of a joined WebSocket channel. If a known hosted failure remains active, vendor-side recovery or a working alternate transport is still required.

## Gateway timeouts and token-log boundary

The Windows agent no longer starts heartbeat while a startup enrollment request is still pending. The artificial 5-second race did not cancel the underlying HTTPS request and could leave overlapping gateway requests. Gateway transport timeouts are not retried immediately because a server-side request may still be running; non-timeout transient transport errors and retryable HTTP responses retain bounded retries.

The `aria-device-gateway` Edge Function now computes SHA-256 in memory and passes only a lowercase 64-character digest to the service-role-only `authenticate_device_gateway_hash` / `enroll_device_hash` RPCs. The previous RPCs accepted the raw bearer token as a PostgreSQL bind parameter; slow-query logging can persist bind values. The legacy route format is still accepted at the Edge Function boundary for old agents, but it is hashed before any database RPC. Do not expose authorization headers, tokens, or token digests in diagnostics.

## Persistent ARIA-agent diagnostics

The watchdog redirects each ARIA agent launch to timestamped files in `D:\\ARIA-Windows-Agent\\Logs`:
- `agent-stdout-YYYYMMDD-HHmmss-fff.log`
- `agent-stderr-YYYYMMDD-HHmmss-fff.log`

The active paths are also written to `status.json` and the watchdog records an `AGENT_LOGS` line. Use these logs to distinguish a gateway HTTP authorization response from DNS/TLS/socket errors. Never log or print `ARIA_DEVICE_TOKEN`, DPAPI plaintext, or authorization headers when diagnosing the bridge.

## Certification

A complete certification requires both Windows PCs to pass:

1. reboot;
2. no manual DC command;
3. ARIA Windows watchdog starts;
4. DC process starts;
5. device becomes Online in Remote MCP;
6. ARIA can ping/use the device;
7. DC child can be killed;
8. supervisor restarts it;
9. device becomes Online again;
10. no duplicate DC processes.

A code/CI PASS without this physical E2E is not closure.