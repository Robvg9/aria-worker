# ARIA Worker — Adapter Layer + Control Plane

`aria-execution-engine-v1.0.0` · Misión 10.8
`aria-fallback-v1.0.0` · Misión 10.7
`aria-intelligent-router-v1.0.0` · Misión 10.6
`aria-quota-capacity-v1.0.0` · Misión 10.5
`aria-account-manager-v1.0.0` · Misión 10.4
`aria-capability-matrix-v1.0.0` · Misión 10.3
`aria-model-registry-v1.0.1` · Misión 10.2
`aria-adapters-v1.0.0` · Misión 9.6

**Stage 10.9–10.14 corrected scope:**

| Mission | Status |
|---------|--------|
| 10.9 Tool Registry | **PASS** |
| 10.10 Observability | **PASS** |
| 10.11 Health / Availability | **BLOCKED** |
| 10.12 Governance / Human-Gate | **NOT IMPLEMENTED** |
| 10.13 Adapter Boundary | **PASS** |
| 10.14 Universal Integration / Cost-Latency | **NOT IMPLEMENTED** |

Fuente persistente de la **capa de interfaz multi-IA** y de los **registries declarativos del Control Plane**. No es un cerebro de memoria. No almacena secretos.

El runtime vivo permanece en Cloudflare (`aria.robvg9.workers.dev`) + Supabase ARIA. Este repositorio conserva contratos declarativos para que añadir IAs o cuentas no requiera otro pipeline ni copiar credenciales.

## Qué es

```
IA externa → Adapter (auth/protocolo) → ARIA MCP → ChatBending
                                          ↓
                           CAPTURE → GATE → COMMIT → SYNC
```

```
Provider (10.1) → Model (10.2) → Capability (10.3) → Account (10.4) → Quota (10.5) → Router (10.6) → Fallback (10.7) → Execution (10.8)
```

```
Routing ≠ Fallback ≠ Execution ≠ Credentials ≠ Memory
```

## Qué no es

- No escribe Notion.
- No aprueba candidatos.
- No crea `cb_memory_*` por IA.
- No toca BattleCruiser.
- No guarda API keys / tokens / passwords. Solo `credential_ref`.
- No selecciona modelos en 10.8 (10.6 selecciona; 10.7 elige alternativa; 10.8 ejecuta una ruta ya seleccionada y autorizada).
- No reintenta, no rota cuentas, no hace fallback automático desde la ejecución.
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
- `tests/` — pruebas locales

## Tests

```
npm test
```

## Execution Engine 10.8

Data Plane. Convierte una ruta ya seleccionada (10.6/10.7) **y autorizada** (authorization.status === approved) en una única llamada al proveedor vía Provider Adapter.

`execute({ selected_route | capability, authorization, input }, deps?)` → `succeeded` | `failed` | `blocked`.

- Revalida la ruta con `fallback.candidateSelectable` (consume 10.2–10.6; no reimplementa). `unknown` → `blocked / insufficient_evidence`.
- `authorization.status !== 'approved'` → `blocked` (`selected ≠ approved_to_execute`).
- Credenciales: solo `credential_ref` de 10.4 → interfaz `CredentialResolver`. Mecanismo real **CREDENTIAL RESOLVER NOT IMPLEMENTED** (resolver nulo por defecto → `failed / credential_unavailable`).
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
Anti-loop: clave `provider_id|account_id|model_id` + `visited`.  
`rate_limit` no activa fallback salvo permiso explícito (no evadir límites).  
Policy Engine físico: **POLICY INPUT NOT IMPLEMENTED** — se consume un input opcional; no se inventan permisos.

Lookups: `resolve`, `candidateSelectable`, `activationAllows`, `candidateKey`.

## Intelligent Router 10.6

Capa declarativa de selección. `route({ capability })` → `selected` | `no_route`.

Consumes 10.2–10.5. No duplica datos. Selección determinista (lexical sort).  
`unknown` capacity/quota **no** se interpreta como available → el seed actual produce `no_route` hasta que 10.5 materialice evidencia de capacidad.

Lookups: `route`, `collectCandidates`, `capacityAllows`.

## Quota / Capacity Manager 10.5

Capa declarativa. Quota ≠ usage ≠ routing. Seed verificado (ChatBending `quota_registry`):

`acct_openrouter_primary` × `google/gemini-2.5-flash-lite` → status `unknown`

Límites, usage, capacity numérica y rate-limit permanecen `null`. `unknown ≠ 0` y `unknown ≠ available`. No se materializaron RPM/TPM de OpenRouter ni Gemini.

Lookups: `getQuota` / `getCapacity` / `getQuotaForModel` / `getCapacityForModel`.

## Account Manager 10.4

Capa declarativa. Account ≠ Credential. Seed verificado:

`openrouter` → `acct_openrouter_primary` → `google/gemini-2.5-flash-lite`

`credential_ref`: `secret://openrouter/acct_openrouter_primary` (referencia; el secreto no vive aquí).

## Tool Registry 10.9

Inventario declarativo. Solo tools verificadas: `aria_context` (read), `aria_memory_capture` (write_candidate; Gate humano; `canonical_write=false`).  
No ejecuta tools. No selecciona tools. No resuelve credenciales. `unknown ≠ available`.

## Observability 10.10

Contrato de eventos + helpers de laboratorio (`createEvent`, `validateEvent`, `redact`, `emitSafe`).  
Campos de correlación: `trace_id`, `span_id`, `execution_id`, `task_id`, `router_decision_id`, `fallback_decision_id`.  
`timestamp` obligatorio. `usage`/`duration_ms` = `null` cuando no hay evidencia (unknown ≠ 0). Metadata-only. Sin exporters reales.

## Adapter Boundary 10.13

Consolidación documental sobre 10.8 (`execution/ADAPTER_BOUNDARY.md`). Sin cambio de runtime.

## Stage 10.11–10.14 corrected scope

- 10.11 Health / Availability: **BLOCKED** — contrato canónico insuficiente.
- 10.12 Governance / Human-Gate: **NOT IMPLEMENTED** — ownership no recuperable; STOP.
- 10.13 Adapter Boundary: **PASS** — consolidación documental sobre 10.8, sin runtime change.
- 10.14 Universal Integration / Cost-Latency: **NOT IMPLEMENTED** — ownership no recuperable; STOP.

## Estado adapters 2026-09-01

| IA | Cliente real | Pipeline |
|---|---|---|
| Grok | conectado y E2E | mismo |
| Claude | pendiente registro del conector | mismo |
| ChatGPT | pendiente registro del conector | mismo |
| Gemini | pendiente registro del conector | mismo |

El MCP ya acepta `source_application` para cualquier IA. Conectar un cliente nuevo es configuración, no un sistema de memoria.
