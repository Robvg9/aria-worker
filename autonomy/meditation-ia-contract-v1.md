# ARIA — Meditación IA v1

## Purpose

Meditación IA converts ARIA's existing continuous self-improvement and dynamic-goal capabilities into a continuously available, user-controlled operating mode on Windows.

## Loop

`heartbeat → read state → recover stale work → learn → select next goal → create mission → Windows agent executes → verify → checkpoint → next heartbeat`

## Human control

The mode is explicitly opt-in. The Windows Local Agent remains online independently. When Meditation IA is active, the local controller exposes loopback controls and opens a persistent Notepad log.

Supported controls:

- `INICIAR` — activate continuous meditation.
- `PAUSA` — stop creating new work while preserving state.
- `AVANZA` / `CONTINUA` — resume from persisted state.
- `CERRAR` / `DETENER` — checkpoint and stop meditation mode without killing the Windows Local Agent.
- `ESTADO` — append a status snapshot to the Notepad log.

## Safety

- Default heartbeat: 30 seconds.
- Default human-idle requirement: 45 seconds before an autonomous cloud tick is requested.
- A local lock prevents two Meditation IA controllers from becoming active simultaneously.
- Destructive/critical actions and production merges remain human-gated by policy.
- Three consecutive failures of the same mission fingerprint trigger an alternate-strategy signal instead of infinite retry.
- The cloud tick reuses ARIA's existing dynamic-goal engine and existing `aria_mission_create` path rather than creating a parallel planning system.

## Windows surface

The controller uses `127.0.0.1:45873` and exposes `/status`, `/log`, `/start`, `/pause`, `/resume`, and `/stop`.

The UI is a small native PowerShell/WinForms control surface. The activity log is persisted under `D:\ARIA-Windows-Agent\Runtime\meditation\ARIA-Meditation-IA.txt` by default.

## Evidence and checkpoints

Every meditation tick persists a local checkpoint. Mission execution evidence remains governed by the existing mission orchestrator and semantic verification stack. Cloud mission state continues to be authoritative for mission execution; the local checkpoint is the continuity/recovery record for the Windows meditation session.

## Notion boundary

The canonical Vision and architectural knowledge remain in ChatBending/Notion. The Windows runtime intentionally does not store a Notion API credential locally. Notion-facing permanent documentation is updated through the governed ARIA knowledge layer rather than embedding a long-lived Notion secret in the desktop agent.

## Definition of done

1. Continuous controller is implemented and unit-tested.
2. Windows agent starts the controller service without creating a second watchdog.
3. Local controls support start/pause/resume/stop/status.
4. Notepad logging is persistent and command-aware.
5. User-presence guard defers autonomous activity while the user is active.
6. Device-authenticated `/v1/meditation/tick` creates at most one non-terminal autonomous mission and reuses dynamic goal selection.
7. CI validates the core and gateway contract.
8. Physical Windows certification remains a separate evidence gate and must not be claimed from cloud-only tests.
