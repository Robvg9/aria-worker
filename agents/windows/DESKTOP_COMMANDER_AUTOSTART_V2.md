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