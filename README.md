# ARIA Worker — Adapter Layer + Control Plane

`aria-health-availability-v1.0.0` · Misión 10.11
`aria-execution-engine-v1.0.0` · Misión 10.8
`aria-fallback-v1.0.0` · Misión 10.7
`aria-intelligent-router-v1.0.0` · Misión 10.6
`aria-quota-capacity-v1.0.0` · Misión 10.5
`aria-account-manager-v1.0.0` · Misión 10.4
`aria-capability-matrix-v1.0.0` · Misión 10.3
`aria-model-registry-v1.0.1` · Misión 10.2
`aria-adapters-v1.0.0` · Misión 9.6
`aria-governance-v1.0.0` · Misión 10.12
`aria-tool-mcp-gateway-v1.0.0` · Misión 11.1

**Estado Stage 10 actual:**

| Mission | Status |
|---------|--------|
| 10.9 Tool Registry | **PASS** |
| 10.10 Observability | **PASS** |
| 10.11 Health / Availability | **DESIGN CONTROLLED** |
| 10.12 Governance / Human-Gate | **DESIGN CONTROLLED** |
| 10.13 Adapter Boundary | **PASS** |
| 10.14 Universal Integration / Cost-Latency | **NOT IMPLEMENTED** |

**Estado Stage 11 actual:**

| Mission | Status |
|---------|--------|
| 11.1 Tool/MCP Gateway | **DESIGN CONTROLLED** |

Fuente persistente de la **capa de interfaz multi-IA** y de los **registries declarativos del Control Plane**. No es un cerebro de memoria. No almacena secretos.

El runtime vivo permanece en Cloudflare (`aria.robvg9.workers.dev`) + Supabase ARIA. Este repositorio conserva contratos declarativos para que añadir IAs o cuentas no requiera otro pipeline ni copiar credenciales.

## Qué es

```
IA externa → Adapter (auth/protocolo) → ARIA MCP → ChatBending
                                          ↓
                           CAPTURE → GATE → COMMIT → SYNC
```

```
Provider (10.1) → Model (10.2) → Capability (10.3) → Account (10.4) → Quota (10.5) → Router (10.6) → Fallback (10.7) → Execution (10.8) → Governance (10.12) → Tool/MCP Gateway (11.1)
```

```
Routing ≠ Fallback ≠ Execution ≠ Governance ≠ Credentials ≠ Memory
```

## Qué no es

- No escribe Notion.
- No aprueba candidatos de memoria.
- No crea `cb_memory_*` por IA.
- No toca BattleCruiser.
- No guarda API keys / tokens / passwords. Solo referencias como `credential_ref`.
- No selecciona modelos en 10.8 (10.6 selecciona; 10.7 elige alternativa; 10.8 ejecuta una ruta ya seleccionada; 10.12 determina la autorización cuando el contrato/policy vigente lo exige).
- No reintenta, no rota cuentas y no evade rate limits.
- No inventa cuotas, usage ni precios.

## Archivos

- `adapters/` — contrato universal multi-IA (9.6)
- `models/` — Model Registry (10.2)
- `capabilities/` — Capability Matrix (10.3)
- `accounts/` — Account Manager (10.4)
- `quota/` — Quota / Capacity Manager (10.5)
- `router/` — Intelligent Router (10.6)
- `fallback/` — Fallback Engine (10.7)
- `execution/` — Execution Engine (10.8): `lookup.js`, `credentials.js`, `adapters/`
- `health/` — Health / Availability Manager (10.11), design-controlled, unknown-by-default, no live probes
- `governance/` — Execution Governance / Human-Gate Contract (10.12), design-controlled, fail-closed, no live execution
- `mcp-gateway/` — Tool/MCP Gateway Contract and deterministic validation (11.1), design-controlled, live dispatch disabled
- `tests/` — pruebas locales

## Tests

```
npm test
```

## Tool / MCP Gateway 11.1

Boundary governed between ARIA and external tools/services. It consumes the Tool Registry, an approved Governance decision and a protocol-specific adapter boundary; it does not become the Router, Governance engine, Execution Engine or Credential Resolver.

- Resolves only registered tools/operations supplied by the caller; unknown/unavailable tools fail closed.
- Authorization is bound to execution, request, tool, operation and risk class.
- High-risk and destructive operations require an explicit human verification result when Governance requires it.
- Plaintext passwords and credentials are never accepted, stored or logged.
- Results are normalized and intended to be sanitized before exposure.
- `v1` is validation/design-controlled only. No live external dispatch.

Contrato: `mcp-gateway/contract.md`.

## Health / Availability Manager 10.11

Diseño controlado y declarativo. Consume evidencia de salud/availability cuando exista, pero **no genera evidencia por inferencia**.

- `health.status` = `unknown | healthy | degraded | unavailable`.
- `availability.status` = `unknown | available | unavailable`.
- El seed actual queda en `unknown` porque no existe una observación LIVE en este layer.
- `unknown` no se convierte en `available`/`healthy` por metadata de registry.
- No realiza network calls, credential resolution, routing, fallback, quota mutation ni memory writes.
- `getHealth`, `listHealth`, `isObserved`, `isAvailable` son lookups puros.

Contrato: `health/contract.md`.

## Execution Governance / Human-Gate 10.12

Diseño controlado del punto de autoridad entre una ruta seleccionada y una ejecución autorizada.

- `selected` **no** implica `approved`.
- Riesgos: `READ`, `LOW_RISK_WRITE`, `HIGH_RISK_WRITE`, `DESTRUCTIVE`.
- Estados: `pending_approval`, `approved`, `rejected`, `expired`, `invalid`.
- Fail-closed ante ausencia de autorización, mismatch de scope, expiración o rechazo.
- Una aprobación queda vinculada a `execution_id` y, cuando estén definidos por la solicitud, a `request_id`, `task_id`, `tool_id`, `operation` y `risk_class`.
- `approved` exige `reviewed_by`, `reviewed_at` y `evidence_ref`.
- No auto-approve.
- No persistent approval store, no UI y no LIVE execution en v1.
- No sustituye Router, Fallback, Execution, Credentials, Quota ni Memory Authority.

Contrato: `governance/contract.md`.

## Execution Engine 10.8

Data Plane. Convierte una ruta ya seleccionada (10.6/10.7) y autorizada (`authorization.status === approved`) en una única llamada al proveedor vía Provider Adapter.

`execute({ selected_route | capability, authorization, input }, deps?)` → `succeeded` | `failed` | `blocked`.

- Revalida la ruta con `fallback.candidateSelectable` (consume 10.2–10.6; no reimplementa). `unknown` → `blocked / insufficient_evidence`.
- `authorization.status !== 'approved'` → `blocked` (`selected ≠ approved_to_execute`).
- Credenciales: solo `credential_ref` de 10.4 → interfaz `CredentialResolver`. Mecanismo real **CREDENTIAL RESOLVER NOT IMPLEMENTED**.
- Adapter registrado: `openrouter_chat_completions` (`openrouter` / `text_generation`). Transport inyectable; tests 100 % mock.
- `execution_id` determinista (sha256 canónico). Un intento por llamada. Sin retry, sin rotación, sin account hopping.
- Usage del proveedor se copia como `reported` o queda `unknown`; nunca se estima ni alimenta 10.5.
- Hook `onEvent` (10.10) opcional; sin telemetría persistida. Sin escritura de memoria canónica (`CAPTURE → GATE → COMMIT → SYNC` intacto).
- **LIVE no ejecutado**: no existe credencial real autorizada ni resolver; la ruta seed sigue bloqueada por 10.5 `unknown`.

Contrato: `execution/contract.md`.

## Fallback Engine 10.7

Capa declarativa de alternativa. Consume el resultado de 10.6.

`resolve({ router_result, failure })` → `primary` | `fallback` | `no_fallback`.

No ejecuta. No llama proveedores. No muta registries. No almacena secretos.
`unknown` capacity/quota **no** se interpreta como available.

## Intelligent Router 10.6

Capa declarativa de selección. `route({ capability })` → `selected` | `no_route`.

Consume 10.2–10.5. No duplica datos. Selección determinista.
`unknown` capacity/quota **no** se interpreta como available.

## Quota / Capacity Manager 10.5

Capa declarativa. Quota ≠ usage ≠ routing.

## Account Manager 10.4

Capa declarativa. Account ≠ Credential.

## Tool Registry 10.9

Inventario declarativo de herramientas verificadas. No ejecuta ni selecciona herramientas.

## Observability 10.10

Contrato de eventos + helpers de laboratorio. Metadata-only. Sin exporters reales ni persistencia.

## Adapter Boundary 10.13

Consolidación documental sobre 10.8. Sin cambio de runtime.

## Stage 10.11–10.14

- 10.11 Health / Availability: **DESIGN CONTROLLED**.
- 10.12 Governance / Human-Gate: **DESIGN CONTROLLED**.
- 10.13 Adapter Boundary: **PASS**.
- 10.14 Universal Integration / Cost-Latency: **NOT IMPLEMENTED** — ownership no recuperable.

## Estado adapters 2026-09-01

| IA | Cliente real | Pipeline |
|---|---|---|
| Grok | conectado y E2E | mismo |
| Claude | pendiente registro del conector | mismo |
| ChatGPT | pendiente registro del conector | mismo |
| Gemini | pendiente registro del conector | mismo |

El MCP ya acepta `source_application` para cualquier IA. Conectar un cliente nuevo es configuración, no un sistema de memoria.
