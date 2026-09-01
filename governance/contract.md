# ARIA Governance / Human-Gate Contract (Misión 10.12)

**Versión:** `aria-governance-v1.0.0`
**Capa:** Control Plane / Policy & Authorization
**Autoridad de memoria:** ninguna

```
Routing ≠ Execution ≠ Authorization
selected ≠ approved_to_execute
```

## 1. Responsabilidad

10.12 define el contrato de autorización para cualquier ejecución futura.
Una decisión de Router/Fallback **no** autoriza por sí misma la ejecución.

Estados: `pending_gate | approved | denied | blocked | expired | invalid`

## 2. Reglas núcleo

- Sin autorización válida → `blocked`.
- El Gate identifica `task_id`, acción, ruta, impacto, coste/riesgo y evidencia.
- No se leen ni exponen secretos para decidir autorización.
- No retry/fallback/rotation implícitos.
- Decisiones deterministas y explicables.
- Gate humano obligatorio para memoria canónica y operaciones de alto riesgo.

## 3. Contract

```json
{
  "governance_version": "1",
  "task_id": "string",
  "action_type": "string",
  "route": { "provider_id": null, "model_id": null, "account_id": null },
  "authorization": {
    "status": "pending_gate|approved|denied|blocked|expired|invalid",
    "authority": "human|policy|none",
    "evidence_ref": null
  },
  "impact": {
    "external_effect": false,
    "cost_possible": false,
    "memory_mutation": false,
    "system_mutation": false
  },
  "decision": { "status": "blocked", "reason": "" },
  "metadata": { "deterministic": true, "no_secret_access": true }
}
```

## 4. Lookups

- `evaluateAuthorization(request)` → decision
- `isApproved(auth)` → boolean
- `requiresHumanGate(action, impact)` → boolean

## 5. Defaults seguros

| Operación | Default |
|---|---|
| route (evidencia suficiente) | allow (policy) |
| fallback automático | deny until authorized |
| execution de modelo | require_gate / approved |
| memoria write | require_gate |
| secret read/output | deny |
| credential mutation | require_gate |
| Bridge activation | require_gate |

## 6. FUTURE DEPENDENCY — PREPARED, NOT ACTIVATED

- Persistent approval store
- Expiry / revocation runtime
- Human approval UI

No se activan en 10.12.
