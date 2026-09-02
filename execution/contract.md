# ARIA Execution Engine — Contract (Misión 10.8)

**Versión:** `aria-execution-engine-v1.1.0`
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

10.8 convierte **una ruta ya seleccionada y ya autorizada** en una única llamada al proveedor, a través de un Provider Adapter, y devuelve un resultado normalizado.

10.8 **NO** decide modelo, elige alternativas, crea rutas, cambia de cuenta/proveedor/modelo, convierte `unknown` en `available`, reintenta/rota/fallback automático, almacena o expone credenciales, escribe memoria canónica ni inventa telemetría.

## 2. Flujo

```
Execution Request
→ Route Resolution      (consume 10.6/10.7 o recibe selected_route; valida con 10.7 candidateSelectable)
→ Authorization Gate    (authorization.status === "approved"; 10.12)
→ Credential Resolution (credential_ref → CredentialResolver; secreto solo en el call path)
→ Provider Adapter      (adapter por provider_id; 10.13)
→ Provider API          (una llamada, vía transport inyectable)
→ Execution Result      (normalizado, sin secretos)
```

## 3. Input (`ExecutionRequest`)

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
  "policy": { "...": "opcional; se pasa a 10.7 candidateSelectable" }
}
```

`selected_route` se revalida con `fallback.candidateSelectable(...)`; 10.8 no duplica Router/Fallback/Quota logic. `authorization.status !== approved` bloquea.

## 4. `execution_id`

```
execution_id = "exec_" + sha256(canonical_json({ task_id, provider_id, account_id, model_id, capability, input })).slice(0, 32)
```

Misma solicitud → mismo id. No usa reloj ni aleatoriedad.

## 5. Estados

`pending → running → succeeded | failed | cancelled | blocked` es el modelo canónico de 10.13; v1 no emite `cancelled`.

`blocked.reason` incluye `authorization_missing | authorization_not_approved | route_missing | no_route | route_not_selectable | insufficient_evidence | credential_ref_missing | adapter_unavailable | capability_missing | input_missing`.

`failed.error.code` incluye `credential_unavailable | provider_error | transport_error | timeout | adapter_error | invalid_response`.

`failed` no dispara fallback ni retry dentro de 10.8.

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
  "metadata": { "engine_version": "aria-execution-engine-v1.1.0", "adapter_id": "openrouter_chat_completions", "mode": "mock | live", "attempt": 1, "memory_authority": "none", "canonical_write": false }
}
```

Ningún campo de resultado puede contener material de credencial. `error.message` se sanitiza.

## 7. Credenciales

10.4 entrega solo `credential_ref` (`secret://{provider}/{account}`). 10.8 llama a `CredentialResolver`:

```js
resolve(credential_ref) → { status: "resolved", secret } | { status: "unavailable", reason }
```

En Block B, la implementación concreta es un resolver inyectado: `createCredentialResolver({ getSecret })`. Solo acepta referencias canónicas y soporta resolución async. Una implementación adicional adapta bindings de Cloudflare mediante una tabla no secreta `ref → bindingName`.

El secret es transitorio y se entrega únicamente al adapter dentro del mismo call path. Nunca aparece en `ExecutionResult`, eventos, logs ni errores.

El resolver concreto no lee configuración ambiental, archivos, bases de datos o red por sí mismo y no persiste credenciales. Los errores del proveedor de secretos se normalizan a `resolver_error`.

Se conserva `nullCredentialResolver` como fallback explícito cuando ningún resolver es inyectado; en ese caso la ejecución termina `failed / credential_unavailable`.

## 8. Provider Adapter (10.13)

Cada adapter declara `adapter_id`, `provider_id`, `interface_type`, `operations`, `status` y expone:

```js
execute({ route, input, secret, transport }) → { ok: true, response, usage_raw } | { ok: false, error }
```

El adapter traduce el payload y normaliza la respuesta. No decide ruta, no reintenta, no rota cuentas y no escribe memoria. El transport es inyectable. El adapter registrado sigue siendo `openrouter_chat_completions` para `openrouter/text_generation`.

## 9. Observability hook

`deps.onEvent(event)` opcional. Eventos: `execution.started`, `execution.completed`, `execution.failed`, `execution.blocked`. Sin secretos ni persistencia.

## 10. LIVE vs MOCK

Tests: adapters/transports/resolvers controlados; cero llamadas reales. `metadata.mode = live` solo cuando se usa el transport real y el resolver devuelve `resolved`.

No se ejecuta un smoke test de producción en CI porque ningún secreto de producción se incorpora ni se auto-provisiona. La ruta seed continúa bloqueada cuando 10.5 mantiene `unknown`.

## 11. Invariantes

- Ruta válida + approved + resolver mock + adapter mock → `succeeded`.
- Ruta/provider/model/account/capability inexistente → `blocked`.
- `credential_ref` ausente → `blocked / credential_ref_missing`.
- Secreto no disponible → `failed / credential_unavailable` sin material sensible.
- Error del proveedor → `failed / provider_error`.
- `execution_id` determinista.
- Router/Fallback/registries no mutados por 10.8.
- Sin account hopping, bypass de quota/capacity o retry.
- Sin writers de memoria en `execution/`.
