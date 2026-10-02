# ARIA / Desktop Commander Remote — Autostart

## Objective

Remove the recurring manual PowerShell startup requirement for Desktop Commander Remote on the Windows machines used by ARIA.

## Design

The existing ARIA Windows Local Agent already runs as an interactive Scheduled Task at logon. This feature adds a separate Scheduled Task:

- Name: ARIA-Desktop-Commander-Remote
- Trigger: interactive user logon
- Principal: current interactive user, LeastPrivilege
- Supervisor: desktop-commander-supervisor.ps1
- Desktop Commander package: pinned to @wonderwhy-er/desktop-commander@0.2.52
- Command: npx --yes @wonderwhy-er/desktop-commander@0.2.52 remote

The bootstrap installs Desktop Commander once into a dedicated runtime/cache on D:. The supervisor never invokes `npx` for normal operation.

The supervisor:

1. Detects an already-running Desktop Commander Remote process and adopts it.
2. Starts Desktop Commander when absent.
3. Detects a crashed/stopped process and relaunches it.
4. Logs state to D:\ARIA-Windows-Agent\Logs.
5. Does not bypass Desktop Commander authentication/pairing. Authentication remains a Human Gate.

## Why it is separate

The ARIA mission/runtime agent must not become dependent on the health of the Desktop Commander channel. A broken DC process must therefore not terminate the ARIA watchdog.

## Verification gates

Static/contract verification can run in CI.

LIVE certification still requires each physical PC to show:

Desktop Commander Remote process running
→ device Online in Remote MCP
→ ARIA remote tool call succeeds

A task install without that LIVE chain is not considered closed.

## Recovery behavior

The supervisor is itself restarted by Task Scheduler after failure. The supervisor restarts the DC process after an unexpected exit.

## Security boundary

This mechanism only manages the local DC process. It does not:

- grant new ARIA permissions;
- resolve or store DC credentials;
- modify mission state;
- bypass Human Gate;
- execute arbitrary external code;
- replace ARIA device/capability authority.
