# ARIA Observability / Telemetry — Contract (Misión 10.10)

**Versión:** `aria-observability-v1.0.0`
**Capa:** Control Plane / Observability
**Autoridad de memoria:** ninguna (`memory_authority: none`, `canonical_write: false`)

Fuente canónica: MISIÓN 10.10 — Observability / Telemetry Design (ChatBending).

```
Observability ≠ Router ≠ Fallback ≠ Execution ≠ Memory Authority
Telemetry ≠ Source of truth for secrets
Telemetry ≠ fabricated quota/cost
```

## 1. Responsabilidad

10.10 define el contrato de eventos y correlación para reconstruir cada request:

ingress → routing → fallback → execution → result

Observa decisiones; **no las modifica**.

## 2. Identidad y correlación (canónico)

Cada operación debe poder conservar:

- `trace_id`
- `span_id`
- `execution_id`
- `task_id`
- `router_decision_id` (cuando exista)
- `fallback_decision_id` (cuando exista)

La identidad del modelo diferencia **ruta de acceso** (`provider_id`) de **origen/upstream** (`upstream_provider_id`).

## 3. Event contract v1

```json
{
  "event_id": "string",
  "request_id": "string|null",
  "trace_id": "string|null",
  "span_id": "string|null",
  "stage": "ingress|routing|fallback|execution|result",
  "status": "started|completed|failed|skipped|unknown",
  "task_id": "string|null",
  "execution_id": "string|null",
  "router_decision_id": "string|null",
  "fallback_decision_id": "string|null",
  "provider_id": "string|null",
  "upstream_provider_id": "string|null",
  "account_id": "string|null",
  "model_id": "string|null",
  "capability_id": "string|null",
  "outcome": "success|error|timeout|blocked|insufficient_evidence|null",
  "timestamp": "ISO-8601",
  "duration_ms": null,
  "usage": null,
  "error_code": null,
  "metadata": {}
}
```

Campos obligatorios al validar un evento emitido:

- `event_id` (string no vacío)
- `timestamp` (string ISO-8601)
- `stage` (enum o `unknown`)
- `status` (enum)

Campos opcionales / nullable (válidos como `null`):
`request_id`, `trace_id`, `span_id`, `task_id`, `execution_id`, `router_decision_id`, `fallback_decision_id`, `provider_id`, `upstream_provider_id`, `account_id`, `model_id`, `capability_id`, `outcome`, `duration_ms`, `usage`, `error_code`.

## 4. Eventos críticos

- router.decision
- fallback.evaluation
- execution.started
- execution.completed
- execution.failed
- execution.blocked
- policy.blocked
- telemetry.redacted

## 5. Seguridad

- **Default: metadata-only.** Nunca prompts, respuestas, tool arguments, credenciales, tokens o PII por defecto.
- `usage` y `duration_ms` solo cuando existe evidencia observable; **ausencia ≠ cero** (`null`, no `0`).
- Sanitización de mensajes de error (ya presente en 10.8).

## 6. Lookups / helpers (laboratorio)

- `createEvent(partial)` — construye evento con defaults seguros (`timestamp` auto, ids opcionales null)
- `validateEvent(event)` — comprueba campos obligatorios, tipos, enums y ausencia de secretos
- `redact(value)` — elimina patrones de secreto
- `emitSafe(onEvent, event)` — emite sin dejar que fallos de observability afecten el plano de ejecución

## 7. Integración con 10.8

10.8 ya expone `deps.onEvent`. 10.10 formaliza el payload y las reglas de seguridad.
No se modifica la lógica de routing/fallback/execution.

## 8. FUTURE DEPENDENCY — PREPARED, NOT ACTIVATED

- Persistencia de traces (OpenTelemetry exporter)
- Métricas agregadas
- Dashboard / alertas
- Opt-in content capture con redacción

Ninguno se activa en 10.10.
