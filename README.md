# ARIA Worker — Adapter Layer + Control Plane

`aria-fallback-v1.0.0` · Misión 10.7 (HEAD)
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
Provider (10.1) → Model (10.2) → Capability (10.3) → Account (10.4) → Quota (10.5) → Router (10.6) → Fallback (10.7)
```

## Qué no es

- No escribe Notion.
- No aprueba candidatos.
- No crea `cb_memory_*` por IA.
- No toca BattleCruiser.
- No guarda API keys / tokens / passwords. Solo `credential_ref`.
- No ejecuta modelos ni consume tokens (10.6 selecciona; 10.7 elige alternativa).
- No inventa cuotas, usage ni precios.

## Archivos

- `adapters/` — contrato universal multi-IA (9.6)
- `models/` — Model Registry (10.2)
- `capabilities/` — Capability Matrix (10.3)
- `accounts/` — Account Manager (10.4)
- `quota/` — Quota / Capacity Manager (10.5)
- `router/` — Intelligent Router (10.6)
- `fallback/` — Fallback Engine (10.7)
- `tests/` — pruebas locales

```
npm test
```

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
`unknown` capacity/quota **no** se interpreta como disponible → el seed actual produce `no_route` hasta que 10.5 materialice evidencia de capacidad.

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

## Estado adapters 2026-09-01

| IA | Cliente real | Pipeline |
|---|---|---|
| Grok | conectado y E2E | mismo |
| Claude | pendiente registro del conector | mismo |
| ChatGPT | pendiente registro del conector | mismo |
| Gemini | pendiente registro del conector | mismo |

El MCP ya acepta `source_application` para cualquier IA. Conectar un cliente nuevo es configuración, no un sistema de memoria.
