# ARIA Worker — Adapter Layer + Control Plane

`aria-stage10-9-14-v1.0.0` · Misiones 10.9–10.14 (HEAD branch)
`aria-execution-engine-v1.0.0` · Misión 10.8
`aria-fallback-v1.0.0` · Misión 10.7
`aria-intelligent-router-v1.0.0` · Misión 10.6
`aria-quota-capacity-v1.0.0` · Misión 10.5
`aria-account-manager-v1.0.0` · Misión 10.4
`aria-capability-matrix-v1.0.0` · Misión 10.3
`aria-model-registry-v1.0.1` · Misión 10.2
`aria-adapters-v1.0.0` · Misión 9.6

Fuente persistente de la **capa de interfaz multi-IA** y de los **registries declarativos del Control Plane**. No es un cerebro de memoria. No almacena secretos.

El runtime vivo permanece en Cloudflare (`aria.robvg9.workers.dev`) + Supabase ARIA. Este repositorio conserva contratos declarativos para que añadir IAs o cuentas no requiera otro pipeline ni copiar credenciales.

## Qué es

```
IA externa → Adapter (auth/protocolo) → ARIA MCP → ChatBending
                                          ↓
                           CAPTURE → GATE → COMMIT → SYNC
```

```
Provider (10.1) → Model (10.2) → Capability (10.3) → Account (10.4) → Quota (10.5)
→ Router (10.6) → Fallback (10.7) → Execution (10.8)
→ Tool Registry (10.9) → Observability (10.10) → Lifecycle (10.11) → Governance (10.12)
→ Adapter Boundary (10.13) → Universal Integration (10.14)
```

```
Routing ≠ Fallback ≠ Execution ≠ Credentials ≠ Memory ≠ Telemetry ≠ Governance
```

## Qué no es

- No escribe Notion.
- No aprueba candidatos.
- No crea `cb_memory_*` por IA.
- No toca BattleCruiser.
- No guarda API keys / tokens / passwords. Solo `credential_ref`.
- No selecciona modelos en 10.8 (10.6 selecciona; 10.7 elige alternativa; 10.8 solo ejecuta una ruta ya seleccionada y autorizada).
- No reintenta, no rota cuentas, no hace fallback automático desde la ejecución.
- No inventa cuotas, usage ni precios.
- Observability no es autoridad de memoria ni de routing.
- Tool Registry no ejecuta tools (Etapa 11).

## Archivos nuevos (10.9–10.14)

- `tools/` — Tool Registry (10.9): inventario declarativo `aria_context` + `aria_memory_capture`
- `observability/` — Telemetry contract + helpers (10.10)
- `lifecycle/` — State machine helpers (10.11)
- `governance/` — Human-Gate / authorization evaluation (10.12)
- `execution/ADAPTER_BOUNDARY.md` — consolidación 10.13 sobre 10.8
- `integration/universal.js` — composición 10.14 (planAndGuard + executeGuarded)

## Archivos previos

- `adapters/` — 9.6
- `models/` — 10.2
- `capabilities/` — 10.3
- `accounts/` — 10.4
- `quota/` — 10.5
- `router/` — 10.6
- `fallback/` — 10.7
- `execution/` — 10.8
- `tests/` — pruebas locales

```
npm test
```

## 10.9 Tool Registry

Inventario declarativo. Solo tools verificados (MCP ARIA). No ejecución. `unknown ≠ available`.

## 10.10 Observability

Contrato de eventos + `createEvent` / `validateEvent` / `redact` / `emitSafe`. Metadata-only por defecto. Sin secretos.

## 10.11 Lifecycle

Estados de ejecución y gobernanza + transiciones válidas.

## 10.12 Governance

`selected ≠ approved_to_execute`. `evaluateAuthorization`, `requiresHumanGate`. Memory write → human gate.

## 10.13 Adapter Boundary

Consolidación documental sobre la implementación existente de 10.8. Sin cambios de runtime.

## 10.14 Universal Integration

`planAndGuard` + `executeGuarded`. Compone governance + execution sin llamadas LIVE.

## Estado adapters 2026-09-01

| IA | Cliente real | Pipeline |
|---|---|---|
| Grok | conectado y E2E | mismo |
| Claude | pendiente registro del conector | mismo |
| ChatGPT | pendiente registro del conector | mismo |
| Gemini | pendiente registro del conector | mismo |
