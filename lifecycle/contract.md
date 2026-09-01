# ARIA Lifecycle / State Machine (Misión 10.11)

**Versión:** `aria-lifecycle-v1.0.0`
**Capa:** Control Plane / Lifecycle

## Estados de ejecución (alineados con 10.8 / 10.13)

`pending → running → succeeded | failed | cancelled | blocked`

## Estados de gobernanza (10.12)

`pending_gate | approved | denied | blocked | expired | invalid`

## Reglas

- Una ejecución no autorizada no puede pasar a `queued`/`running`.
- `failed` produce evidencia; no dispara retry/fallback automático.
- `cancelled` reservado; no emitido en v1.
- Transiciones deterministas; sin autoridad de memoria.

## FUTURE DEPENDENCY — PREPARED, NOT ACTIVATED

Persistencia de estado de tareas de larga duración (Etapa 12 Execution Engine multi-step).
