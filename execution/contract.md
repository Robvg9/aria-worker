# ARIA Execution Engine — Contract (Misión 10.8)

**Versión:** `aria-execution-engine-v1.0.0`
**Capa:** Data Plane / Execution Layer
**Autoridad de memoria:** ninguna (`memory_authority: none`, `canonical_write: false`)

```
10.1 Provider → 10.2 Model → 10.3 Capability → 10.4 Account → 10.5 Quota/Capacity
→ 10.6 Router → 10.7 Fallback → 10.8 Execution
```

```
Routing ≠ Fallback ≠ Execution ≠ Credentials ≠ Memory
```

## 1. Responsabilidad

10.8 convierte **una ruta ya seleccionada y ya autorizada** en una única llamada
real al proveedor, a través de un Provider Adapter, y devuelve un resultado
normalizado.

10.8 **NO**:

- decide qué modelo usar (10.6 Router);
- elige alternativas ante fallo (10.7 Fallback);
- crea rutas ni acepta rutas que no existan en 10.2–10.5;
- cambia de cuenta/proveedor/modelo para evadir límites (account hopping);
- convierte `quota/capacity/rate_limit = unknown` en `available`;
- reintenta, rota ni hace fallback automático (una ruta → un intento);
- almacena, imprime o devuelve credenciales;
- escribe en ChatBending / Notion / Supabase ni en ninguna memoria canónica
  (todo conocimiento derivado sigue `CAPTURE → GATE → COMMIT → SYNC`);
- inventa telemetría (solo emite eventos a un hook opcional, ver §9).

## 2. Flujo

```
Execution Request
→ Route Resolution      (consume 10.6/10.7 o recibe selected_route; valida con 10.7 candidateSelectable)
→ Authorization Gate    (authorization.status === "approved"; 10.12)
→ Credential Resolution (credential_ref → CredentialResolver; secreto nunca sale de este paso)
→ Provider Adapter      (adapter por provider_id; 10.13)
→ Provider API          (una llamada, vía transport inyectable)
→ Execution Result      (normalizado, sin secretos)
```

## 3. Input de ejecución (`ExecutionRequest`)

```json
{
  "capability": "text_generation",
  "selected_route": {
    "status": "selected | primary | fallback",
    "provider_id": "openrouter",
    "account_id": "acct_openrouter_primary",
    "model_id": "google/gemini-2.5-flash-lite",
    "capability": "text_generation"
  },
  "authorization": { "status": "approved", "evidence_ref": "..." },
  "input": { "modality": "text", "payload": { "messages": [ { "role": "user", "content": "..." } ] } },
  "task_id": "opcional",
  "policy": { "...": "opcional; se pasa tal cual a 10.7 candidateSelectable" }
}
```

| Campo | Regla |
|---|---|
| `selected_route` | Salida literal de 10.6 (`selected`) o 10.7 (`primary`/`fallback`). Si falta, 10.8 **consume** `fallback.resolve({capability, policy})` para obtenerla; nunca la fabrica. |
| `capability` | Obligatoria si no viene en `selected_route`. |
| `authorization` | Obligatoria. Solo `status === "approved"` permite ejecutar (10.12: `selected ≠ approved_to_execute`). |
| `input.payload` | Opaco para el Core; lo traduce el adapter. |
| `task_id` | Opcional; participa en `execution_id`. |

Cualquier ruta recibida se **revalida** con `fallback.candidateSelectable(route, capability, deps, policy)`
(10.7), que a su vez consume 10.2 `getModel`, 10.3 `supports`, 10.4 `isAccountActive`/`credentialRefOf`
y 10.6 `capacityAllows`. 10.8 no reimplementa esas comprobaciones.

## 4. `execution_id`

Determinista (10.13: "contrato de ejecución determinista"):

```
execution_id = "exec_" + sha256(canonical_json({ task_id, provider_id, account_id, model_id, capability, input })).slice(0, 32)
```

- Misma solicitud → mismo `execution_id` (idempotencia de identificación).
- Solicitudes distintas → ids distintos.
- No usa reloj ni aleatoriedad.

## 5. Estados

ChatBending define dos vocabularios previos:

- **10.8 (diseño):** `success | error | timeout | blocked | insufficient_evidence`
- **10.13 (Execution Engine Contract):** `pending → running → succeeded | failed | cancelled | blocked`

Este contrato adopta la **máquina de estados de 10.13** como `status` y conserva
el vocabulario de 10.8 como `reason` / `error.code`. No se inventan estados.

| `status` (10.13) | Cuándo | Equivalente 10.8 |
|---|---|---|
| `pending` | Solicitud recibida; aún no ejecutada (interno, no se devuelve). | — |
| `running` | Adapter en curso (interno; emitido al hook como `execution.started`). | — |
| `succeeded` | Adapter devolvió respuesta válida. | `success` |
| `failed` | Adapter/transport/credencial falló. | `error` (`error.code`), `timeout` (`error.code = "timeout"`) |
| `blocked` | Ruta inválida/no seleccionable, sin autorización, sin adapter, sin `credential_ref`. | `blocked`, `insufficient_evidence` (`reason`) |
| `cancelled` | Reservado por 10.13. **No emitido** en v1.0.0: no existe mecanismo de cancelación en 10.8. | — |

`blocked.reason` (determinista):

```
authorization_missing | authorization_not_approved | route_missing | no_route |
route_not_selectable | insufficient_evidence | credential_ref_missing | adapter_unavailable |
capability_missing | input_missing
```

`failed.error.code`:

```
credential_unavailable | provider_error | transport_error | timeout | adapter_error | invalid_response
```

`failed` **nunca** dispara fallback ni retry dentro de 10.8. Quien orquesta puede
invocar 10.7 con `failure.kind = execution_failure` (u otro kind declarado) en
una nueva llamada.

## 6. Resultado (`ExecutionResult`)

```json
{
  "execution_id": "exec_…",
  "status": "succeeded | failed | blocked",
  "route": { "provider_id": "…", "account_id": "…", "model_id": "…", "capability": "…" },
  "response": { "modality": "text", "content": "…", "provider_response_id": "…", "finish_reason": "…" },
  "error": { "code": "…", "message": "…", "stage": "…", "provider_status": 429 },
  "reason": "…",
  "usage": { "status": "unknown", "prompt_tokens": null, "completion_tokens": null, "total_tokens": null },
  "metadata": {
    "engine_version": "aria-execution-engine-v1.0.0",
    "adapter_id": "openrouter_chat_completions",
    "mode": "mock | live",
    "attempt": 1,
    "memory_authority": "none",
    "canonical_write": false
  }
}
```

- `response` solo en `succeeded`; `error` solo en `failed`; `reason` solo en `blocked`.
- `route` siempre refleja la ruta recibida; 10.8 nunca la altera.
- `usage`: si el proveedor devuelve conteos, se copian tal cual con `status: "reported"`;
  si no, `status: "unknown"` con `null`. **Nunca** se estiman ni se convierten en
  evidencia de 10.5 (10.5 sigue siendo la autoridad de quota/capacity).
- `attempt` es siempre `1` (no hay retry).
- Ningún campo puede contener material de credencial. `error.message` se
  sanitiza: se eliminan cabeceras `Authorization` y patrones de secreto.

## 7. Credenciales

- 10.4 entrega solo `credential_ref` (`secret://{provider}/{account}`).
- 10.8 lo resuelve mediante la interfaz `CredentialResolver`:

```js
resolve(credential_ref) → { status: "resolved", secret } | { status: "unavailable", reason }
```

- El `secret` se pasa **solo** al adapter dentro de la misma llamada y nunca se
  incluye en resultado, eventos, errores ni logs.
- Resolver por defecto: `nullCredentialResolver` → siempre `unavailable`.

> **PENDIENTE (no inventado):** ChatBending define el esquema `secret://…` y
> exige un Credential Store seguro, pero **no define el mecanismo concreto**
> (Cloudflare Secrets, Vault, etc.). Hasta que una misión lo defina, 10.8 solo
> expone la interfaz; toda ejecución con el resolver por defecto termina en
> `failed / credential_unavailable`. `CREDENTIAL_RESOLVER_NOTE = "CREDENTIAL RESOLVER NOT IMPLEMENTED"`.

## 8. Provider Adapter (10.13)

Cada adapter declara: `adapter_id`, `provider_id`, `interface_type`,
`operations` (capabilities soportadas), `status`, y expone:

```js
execute({ route, input, secret, transport }) → { ok: true, response, usage_raw } | { ok: false, error }
```

- El adapter traduce el payload al protocolo del proveedor y normaliza la respuesta.
- No decide ruta, no reintenta, no rota cuentas, no escribe memoria.
- El `transport` (HTTP) es inyectable; los tests usan transports controlados.
- Adapter registrado en v1.0.0: `openrouter_chat_completions` (`provider_id: openrouter`,
  `operations: ["text_generation"]`, endpoint `https://openrouter.ai/api/v1/chat/completions`).

## 9. Observability hook (10.10 — no implementado aquí)

`deps.onEvent(event)` opcional. Eventos: `execution.started`,
`execution.completed`, `execution.failed`, `execution.blocked`.
Payload: `{ event, execution_id, route, status, reason|error.code }`. Sin
secretos, sin timestamps generados por 10.8, sin persistencia. El contrato de
telemetría pertenece a 10.10.

## 10. LIVE vs MOCK

- Tests: adapters/transports/resolvers controlados. **Cero** llamadas reales.
- `metadata.mode = "live"` solo cuando el transport es el real (`fetch`) **y**
  el resolver devolvió `resolved`. Requiere credencial real autorizada por
  humano; no existe en esta misión → **LIVE no ejecutado**.
- Ruta seed real (`openrouter / acct_openrouter_primary / google/gemini-2.5-flash-lite`):
  10.5 mantiene `unknown` → 10.6/10.7 no la seleccionan → 10.8 devuelve
  `blocked / insufficient_evidence` (unknown ≠ available). Esto es correcto.

## 11. Invariantes verificados por `tests/execution.test.js`

- ruta válida + approved + resolver mock + adapter mock → `succeeded`;
- ruta/provider/model/account/capability inexistente → `blocked`;
- `credential_ref` ausente → `blocked / credential_ref_missing`;
- secreto no disponible → `failed / credential_unavailable` sin material;
- error del proveedor → `failed / provider_error`;
- `execution_id` determinista y único;
- Router (10.6) y Fallback (10.7) sin modificar (hash de archivos + sin mutación);
- sin secretos en código, resultados, eventos ni errores;
- sin account hopping; sin bypass de quota/capacity; sin retry;
- sin writers de memoria (Notion/Supabase/ChatBending) en `execution/`.
