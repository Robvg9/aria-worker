# ARIA — Meditación IA / Autonomous Continuity Engine v1

## Purpose

Give ARIA a user-controlled continuous operating mode that reuses its existing autonomy stack instead of requiring Robert to issue a new mission every cycle.

## Canonical loop

`Vision → state → heartbeat → recover → learn → select dynamic goal → mission → execute → verify → evidence → checkpoint → next cycle`

The mode is opt-in. The Windows Local Agent stays online independently.

## Controls

Local loopback: `127.0.0.1:45873`

- `INICIAR` / `/start`
- `PAUSA` / `/pause`
- `AVANZA` / `CONTINUA` / `/resume`
- `CERRAR` / `DETENER` / `/stop`
- `ESTADO` (Notepad command)

When stopping, the controller writes a checkpoint and releases its lock. It does not kill the Windows Local Agent.

## Human presence

Before an autonomous tick the local controller checks Windows last-input activity. While the user is active, autonomous work is deferred. Human commands are processed before that guard, so `CERRAR` remains usable while the user is interacting with the machine.

## Failure policy

A repeated failure is tracked by mission fingerprint. Three consecutive failures emit an explicit alternate-strategy event instead of an unlimited retry loop. The cloud dynamic-goal engine also turns recent failures into corrective goals and can route work back through the existing multi-model planning layer.

## Safety boundary

Critical/destructive actions and production merges remain human-gated. A text consensus between models is not treated as evidence; the existing ARIA evidence/verification rules remain authoritative.

No long-lived Notion credential is stored on Windows. The cloud runtime remains responsible for canonical mission state, memory and durable knowledge.

## Windows surface

The controller persists state under `D:\ARIA-Windows-Agent\Runtime\meditation` by default and maintains `ARIA-Meditation-IA.txt`. A minimal WinForms UI exposes the four main controls and live status/log viewing.

## Reuse of current ARIA components

Meditación IA intentionally reuses `dynamic-goal-engine`, `autonomous-runtime`, mission orchestration, verification/replanning, learning and the Windows device gateway. It is a continuity layer, not a competing planner.

## Definition of done

Cloud contract deployed in `aria-device-gateway` version 28; clean implementation branch includes the controller, policy, Windows bridge/UI, installer/stop helper, tests and CI. Physical Windows certification is the final external evidence gate and must be performed on the real PC.
