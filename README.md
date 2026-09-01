# ARIA Worker — Adapter Layer + Control Plane

`aria-stage10-corrected-v1.0.0` · branch `grok/stage10-9-14`

| Mission | Status |
|---------|--------|
| 10.9 Tool Registry | **PASS** |
| 10.10 Observability | **PASS** (span_id + timestamp + canonical validate) |
| 10.11 Health / Availability | **BLOCKED** (contract page not recovered) |
| 10.12 Governance / Human-Gate | **NOT IMPLEMENTED** (STOP — ownership) |
| 10.13 Adapter Boundary | **PASS** (consolidation on 10.8) |
| 10.14 Cost/Latency or Universal | **NOT IMPLEMENTED** (STOP — ownership) |

Prior layers 9.6 + 10.2–10.8 remain on `main` and are **not modified** by this branch beyond additive files.

## Qué es

```
IA externa → Adapter → ARIA MCP → ChatBending
                         ↓
              CAPTURE → GATE → COMMIT → SYNC
```

```
Provider → Model → Capability → Account → Quota → Router → Fallback → Execution
→ Tool Registry (10.9) → Observability (10.10) → Adapter Boundary (10.13)
```

## Qué no es

- No escribe Notion / no aprueba candidatos.
- No toca BattleCruiser.
- No guarda secretos (solo `credential_ref`).
- Tool Registry **no ejecuta** ni selecciona tools.
- Observability **no** es autoridad de routing ni memoria.
- 10.12 / 10.14 **no implementados** por regla STOP de ChatBending.

## Archivos de esta corrección

- `tools/` — 10.9 Tool Registry (aria_context, aria_memory_capture)
- `observability/` — 10.10 (createEvent con span_id + timestamp)
- `health/CONTRACT_STATUS.md` — 10.11 BLOCKED
- `execution/ADAPTER_BOUNDARY.md` — 10.13 consolidation
- `FUTURE_DEPENDENCIES.md` — 10.12 / 10.14 STOP notes

## Tests

```
npm test
```

Incluye: 9.6 + 10.2–10.8 + tool-registry + observability.

## Estado adapters

| IA | Cliente real |
|---|---|
| Grok | E2E |
| Claude / ChatGPT / Gemini | pendiente registro conector |
