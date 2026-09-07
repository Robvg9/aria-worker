# ARIA Device Resource Contract v1.0

Fase 8 — Multi-Device / Local Runtime.

## Principio
ARIA no razona por marca, sistema operativo o proveedor. Razona sobre un **device resource** con identidad, capacidades, salud, seguridad y un executor gobernado.

## Pipeline canónico

DEVICE DISCOVERY
→ DEVICE REGISTRY
→ CAPABILITY STATE
→ HEALTH STATE
→ SECURITY GATE
→ COGNITION RESOURCE
→ EXECUTOR ADAPTER
→ OBSERVATION
→ VERIFICATION

## Device record

Required canonical fields:
- `device_id`
- `resource_class`
- `platform_family`
- `capabilities`
- `health`
- `security`
- `executor`
- `provenance`

`platform_family` describes the transport/runtime family but must never be the primary cognition selector.

## Resource classes

`mobile`, `desktop`, `browser`, `cloud_runtime`, `database_runtime`, `local_runtime`, `iot`.

## Capability semantics

Capabilities are stable semantic identifiers such as:
- `screen.capture`
- `ui.observe`
- `ui.act`
- `audio.capture`
- `audio.play`
- `shell.execute`
- `file.read`
- `file.write`
- `network.request`
- `database.query`
- `cloud.deploy`
- `device.telemetry`

Unknown capabilities remain unknown and are never inferred.

## Health semantics

Health is observed, not guessed. Canonical states:
`unknown`, `healthy`, `degraded`, `unhealthy`, `offline`.

Only explicit health observations can make a resource selectable for a health-gated task.

## Security semantics

Canonical posture:
`unknown`, `trusted`, `restricted`, `blocked`.

A blocked device can never execute. A restricted device can only execute operations explicitly allowed by policy.

## Executor boundary

The registry and cognition layer MUST NOT call operating-system APIs, browser APIs, SSH, ADB, Cloudflare, Supabase, USB, MQTT or other transports directly.

Those transports live behind an injected `executor` adapter with:
- `capabilities(device)`
- `health(device)`
- `observe(device, operation)`
- `execute(device, operation, input)`

Execution remains subject to upstream authorization/Human Gate controls.

## Secrets

Device metadata may contain credential references but never credential material. Raw tokens, passwords, private keys, authorization headers and binary payloads are rejected.

## Multi-device cognition

A cognition request receives an abstract resource view:
`resource_id + resource_class + capabilities + health + security + provenance`.

It must not depend on a platform-specific field to choose a capability when an equivalent semantic capability exists.

## Live status

A registry declaration is not live evidence. Live availability is established only by the dedicated certification workflow or by an explicit runtime health observation.
