# ARIA Tool Registry — Contract (Misión 10.9)

**Versión:** `aria-tool-registry-v1.0.0`
**Capa:** Control Plane / Tool Inventory
**Autoridad de memoria:** ninguna (`memory_authority: none`, `canonical_write: false`)

```
10.1 Provider → 10.2 Model → 10.3 Capability → 10.4 Account → 10.5 Quota
→ 10.6 Router → 10.7 Fallback → 10.8 Execution
→ 10.9 Tool Registry (inventory only)
```

```
Tool Registry ≠ Tool Router ≠ Execution ≠ Memory Authority ≠ Credential Store
```

## 1. Responsabilidad

10.9 mantiene un inventario declarativo de herramientas (MCP/API) disponibles para ARIA.

- Identidad estable de cada tool (`tool_id`).
- Proveedor / interfaz (`mcp` | `api` | `http` | `internal`).
- Operaciones soportadas y riesgo (`read` | `low_risk_write` | `high_risk_write` | `destructive`).
- Estado de disponibilidad (`available` | `unavailable` | `unknown`).
- Referencias a permisos y scopes; **nunca secretos**.

10.9 **NO**:

- ejecuta herramientas;
- selecciona tools para una tarea (eso es Tool Router futuro / Etapa 11);
- escribe memoria canónica;
- almacena o resuelve credenciales;
- inventa tools no verificados en ChatBending / seed físico;
- convierte `unknown` en `available`.

## 2. Campos canónicos

```json
{
  "tool_id": "string",
  "name": "string",
  "provider_id": "string|null",
  "interface_type": "mcp|api|http|internal",
  "operations": ["read|write|..."],
  "risk_level": "read|low_risk_write|high_risk_write|destructive|unknown",
  "status": "available|unavailable|unknown",
  "permission_refs": [],
  "mcp_tool_name": "string|null",
  "description": "string",
  "metadata": {}
}
```

## 3. Seed verificado

Solo tools con evidencia en el circuito ARIA MCP actual:

- `aria_context` (READ)
- `aria_memory_capture` (WRITE candidate; Gate humano obligatorio)

Cualquier otra tool (GitHub, Supabase, Notion, Web, etc.) se declara únicamente cuando exista evidencia física y autorización explícita. Hasta entonces permanecen fuera del registry o con `status: "unknown"` si se listan como futuras.

## 4. Lookups

- `getTool(toolId)`
- `listTools()`
- `toolsByProvider(providerId)`
- `toolsByRisk(riskLevel)`
- `isAvailable(toolId)`
- `supportsOperation(toolId, operation)`

## 5. Invariantes

1. `tool_id` único y estable.
2. `status === "unknown"` nunca se trata como available.
3. Ningún campo contiene secretos, tokens o API keys.
4. Risk level explícito; default seguro es `unknown` cuando no hay evidencia.
5. Tool Registry no es autoridad de ejecución ni de memoria.
6. Cambios de registry requieren Gate humano (10.12) en fases posteriores.

## 6. Relación con Execution / Governance

- 10.8 Execution invoca **model adapters**, no tools de este registry.
- Tool execution (MCP Client / Tool Gateway) pertenece a Etapa 11.
- 10.9 solo prepara el inventario declarativo para que Tool Router y Permission Engine futuros puedan consumirlo sin inventar.

## 7. FUTURE DEPENDENCY — PREPARED, NOT ACTIVATED

- Tool Router (selección de tools por tarea)
- Permission Engine (evaluación de riesgo + Gate)
- MCP Client runtime
- Integración con 10.10 telemetry para tool spans

Ninguno de estos se activa en 10.9.
