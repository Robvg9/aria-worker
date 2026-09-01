# ARIA Observability / Telemetry — Contract (Misión 10.10)

**Versión:** `aria-observability-v1.0.0`
**Capa:** Control Plane / Observability
**Autoridad de memoria:** ninguna (`memory_authority: none`, `canonical_write: false`)

```
Observability ≠ Router ≠ Fallback ≠ Execution ≠ Memory Authority
Telemetry ≠ Source of truth for secrets
Telemetry ≠ fabricated quota/cost
```

## 1. Responsabilidad

10.10 define el contrato de eventos y correlación para reconstruir cada request:

ingress → routing → fallback → execution → result

Observa decisiones; **no las modifica**.

## 2. Event contract v1

```json
{
  "event_id": "string",
  "request_id": "string",
  "trace_id": "string",
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
  "duration_ms": null,
  "usage": null,
  "error_code": null,
  "metadata": {}
}
```

## 3. Eventos críticos

- router.decision
- fallback.evaluation
- execution.started
- execution.completed
- execution.failed
- execution.blocked
- policy.blocked
- telemetry.redacted

## 4. Seguridad

- **Default: metadata-only.** Nunca prompts, respuestas, tool arguments, credenciales, tokens o PII por defecto.
- `usage` y `duration_ms` solo cuando existe evidencia observable; ausencia ≠ cero.
- Sanitización de mensajes de error (ya presente en 10.8).

## 5. Lookups / helpers (laboratorio)

- `createEvent(partial)` — construye evento con defaults seguros
- `validateEvent(event)` — comprueba campos obligatorios y ausencia de secretos
- `redact(value)` — elimina patrones de secreto
- `emitSafe(onEvent, event)` — emite sin dejar que fallos de observability afecten el plano de ejecución

## 6. Integración con 10.8

10.8 ya expone `deps.onEvent`. 10.10 formaliza el payload y las reglas de seguridad.
No se modifica la lógica de routing/fallback/execution.

## 7. FUTURE DEPENDENCY — PREPARED, NOT ACTIVATED

- Persistencia de traces (OpenTelemetry exporter)
- Métricas agregadas
- Dashboard / alertas
- Opt-in content capture con redacción

Ninguno se activa en 10.10.
