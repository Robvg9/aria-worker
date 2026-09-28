# ARIA — FASE 0: Inventario Operativo Verificado — 2026-09-28

## Estado
- FASE 0: EN CURSO.
- HEAD/main verificado: `f87832fedf204577df2df5663c18293f547c9281`.
- Cloudflare Workers Builds: `completed/success` para ese HEAD.
- Workflow `Deploy ARIA Cloudflare Worker`: `success`.
- Este documento no declara cerrada la FASE 0; registra el inventario actual y los huecos que deben cerrarse antes de FASE 1.

## 0.1 — Fuentes de verdad

| Dominio | Autoridad observada | Estado |
|---|---|---|
| Misiones / estado | `aria_internal.mission_state` | CONFIRMADO |
| Pasos | `aria_internal.mission_steps` | CONFIRMADO |
| Eventos/evidencia de misión | `aria_internal.mission_events` | CONFIRMADO |
| Objetivos dinámicos | `aria_internal.autonomy_goals` | CONFIRMADO |
| Dispositivos | `aria_internal.device_registry` | CONFIRMADO |
| Jobs de ejecución | `aria_internal.execution_jobs` | CONFIRMADO |
| Eventos de jobs | `aria_internal.execution_job_events` | CONFIRMADO |
| Modelos/proveedores | `provider_registry`, `model_registry`, `capability_matrix`, `account_registry` | CONFIRMADO |
| Agentes | `aria_internal.agent_catalog` | CONFIRMADO |
| Decisiones del router | `aria_internal.router_decisions` | CONFIRMADO |
| Ciclos de autonomía | `aria_internal.autonomy_cycles` | CONFIRMADO |
| Aprendizaje | `aria_internal.autonomy_learnings` | CONFIRMADO |
| Notificaciones Meditation | `aria_internal.meditation_notifications` | CONFIRMADO |
| Queue Meditation | `aria_internal.meditation_queue` | CONFIRMADO |
| Auditoría All For One | `all_for_one_runs/auditors/reviews` | CONFIRMADO |
| Release/build | Git SHA + build SHA inyectado + Cloudflare/native check + LIVE smoke | CONFIRMADO |
| Catálogo de tests PWA | fuente estática en PWA + tests/reports | PENDIENTE de reconciliación única |

Filas aproximadas observadas en producción: mission_state 2872, mission_steps 2536, mission_events 86084, execution_jobs 2937, autonomy_goals 826, autonomy_learnings 1661, meditation_queue 38, meditation_notifications 1135.

## 0.2 — Versiones y drift

### Cadena canónica actual observada
`main SHA f87832f` → GitHub Actions → Cloudflare Workers Builds → Worker `aria` → PWA smoke/E2E.

Runtime cognitivo/ejecución observado:
`aria-app-api-v3` → `aria-mission-runner-v22` → `aria-planner-v11` / `aria-canonical-runtime-v1` / `aria-execution-runtime-v1` / `aria-runtime-gateway-v1` → devices/executors → verification/evidence.

Otros componentes canónicos actualmente activos:
- `aria-device-gateway` v174
- `aria-autonomy-supervisor-v5` v27
- `aria-memory-v2` v33
- `aria-learning-v3` v17
- `aria-smart-verifier-v1` v18
- `aria-agent-runtime-v1`
- `aria-github-app-runtime-v1`

### Legacy/drift confirmado en Supabase
Actualmente hay **100 Edge Functions ACTIVE** en producción. Dentro de familias críticas permanecen simultáneamente:

- 12 planners: v1–v12.
- 23 mission runners: v1–v24 con huecos.
- 10 autonomy supervisors: v1–v10.
- 3 app APIs: v1–v3.
- 3 memory variants: bridge-v1, bridge-9-4, v2.
- 16+ superficies MCP/OAuth/gateway con variantes históricas.

Esto es inventario, no permiso para borrar. Antes de retirar cualquier variante hay que demostrar quién la consume y conservar rollback.

## 0.3 — Contratos y rutas

### Ruta canónica de misión
PWA/intake → `aria-app-api-v3` → misión persistida → scheduler/runner → `aria-mission-runner-v22` → planner/runtime/executor → verifier/evidence.

### Ruta de device execution
device → `aria-device-gateway` → RPC gobernada `claim_execution_job_gateway` / start / complete → execution_jobs → executor/device → resultado → evidencia.

### Ruta de autonomía
Cron 34 → `run_mission_runner_tick_v1()` y `aria-autonomy-supervisor-v5`.

El supervisor v5 no llama directamente al runner: llama a `aria-device-gateway:/v1/autonomy/cycle`, All For One, repair supervisor y Meditation tick.

Dentro de `/v1/autonomy/cycle` existe además recovery stale + queue governance + selección/claim de objetivos. Por tanto, runner y supervisor deben permanecer documentados como responsabilidades distintas; no deben fusionarse sin evidencia de duplicación funcional.

## 0.4 — Jobs / leases / recovery

### Cron activos
1. `aria-memory-maintenance-daily` — 03:17 UTC.
2. `aria-autonomy-supervisor-v5-every-minute` — actualmente `*/2 * * * *`.

El job 34 es actualmente el único scheduler activo de autonomía.

El job 34 ejecuta:
- `aria_internal.run_mission_runner_tick_v1()`
- POST a `aria-autonomy-supervisor-v5`

Cron históricamente desactivados siguen presentes, incluyendo memory semantic backfill y skills-learning every-minute.

### Recovery
La función pública canónica `aria_autonomy_recover_stale_missions` existe junto a:
- `aria_autonomy_recover_stale_missions_v1`
- `aria_autonomy_recover_stale_missions_heavy_v1`

La defensa de doble gate ya está LIVE. La existencia de las tres funciones debe quedar documentada como wrapper/gate/cuerpo pesado, no como tres rutas equivalentes.

### Claims
Existen simultáneamente funciones internas y wrappers públicos de:
- claim mission by id
- claim next
- claim next lease
- claim execution job / gateway

Esto requiere matriz explícita de caller → función → autorización → responsabilidad.

## 0.5 — Rutas paralelas / legacy

### No retirar todavía
No se deben borrar las familias planner/runner/supervisor antiguas solo por el nombre. La fase 0 debe identificar primero:
- caller real,
- último uso,
- autorización,
- dependencia de datos,
- rollback.

### Candidatos iniciales de auditoría
- `aria-planner-v1..v10` frente a v11/v12.
- `aria-mission-runner-v1..v21/v23/v24` frente a v22.
- `aria-autonomy-supervisor-v1..v4/v6..v10` frente a v5.
- `aria-app-api-v1/v2` frente a v3.
- memory bridge variantes frente a `aria-memory-v2`.
- MCP server/gateway/oauth históricos.

## 0.6 — Contradicciones conocidas

- Delivery MAIN → LIVE: **RESUELTA** para el HEAD actual; Workers Build nativo + deploy + PWA smoke pasan.
- Supabase/DB pressure: **no debe confundirse con el delivery Cloudflare**; es una línea independiente.
- PWA mission/test counts: permanecen como superficie de reconciliación operacional hasta demostrar una fuente única consumida por UI y backend.
- RWHT/global operational certification: permanece abierta; arquitectura 7/7 no equivale a certificación operacional completa.

## 0.7 — Duplicaciones a eliminar después de auditoría

Las duplicaciones más evidentes son:
1. múltiples versiones activas de planner/runner/supervisor;
2. wrappers públicos e internos para varias operaciones de claim;
3. variantes MCP/Memory históricas simultáneamente activas;
4. múltiples capas de gateway/runtime que requieren trazabilidad de caller.

No se elimina ninguna todavía. Primero se completa el mapa de consumidores.

## Próximas acciones de FASE 0

1. Construir matriz de callers de las familias legacy críticas.
2. Confirmar qué rutas usan realmente planner v11 vs v12.
3. Confirmar qué callers externos siguen usando app-api v1/v2.
4. Confirmar consumidores reales de runner/supervisor antiguos.
5. Reconstruir matriz completa de claim/recovery y autorización.
6. Con esa evidencia, proponer retiro reversible de legacy no utilizado.


## 0.4b — Matriz de claim/recovery verificada

### Mission claims
| Superficie | Delegación | Tráfico observado 12:30–14:55 UTC | Clasificación |
|---|---|---:|---|
| `public.aria_mission_claim_by_id_lease` | → `aria_internal.aria_mission_claim_by_id_lease` | 85 | CANÓNICA / usada |
| `public.aria_mission_claim_next_lease` | → `aria_internal.aria_mission_claim_next_lease` | 62 | CANÓNICA / usada |
| `public.aria_mission_claim_next` | → `aria_internal.aria_mission_claim_next` | 0 observado | CANDIDATA LEGACY; no retirar todavía |
| `aria_internal.aria_mission_claim_eligible` | predicado de elegibilidad | usada por claim/tick | CANÓNICA |
| `run_mission_runner_tick_v1` | → HTTP `aria-mission-runner-v22` | scheduler activo | CANÓNICA |

### Execution-job claim
`public.claim_execution_job_gateway` → `aria_internal.claim_execution_job`.

Tráfico observado: **2898 llamadas HTTP 200** en la ventana auditada. El fast-path vive dentro de `aria_internal.claim_execution_job`; el gateway público es el transporte canónico del device path.

### Stale recovery
`public.aria_autonomy_recover_stale_missions` → `aria_internal.aria_autonomy_recover_stale_missions` → `..._v1` → `..._heavy_v1`.

Tráfico observado: **278 llamadas HTTP 200** al wrapper público en la ventana auditada. El gate de 15 minutos y el cuerpo pesado están separados.

### Conclusión
La FASE 0 ya puede distinguir tres clases:
1. **Ruta canónica demostrada y usada.**
2. **Facade/wrapper necesario para la ruta canónica.**
3. **Variante histórica sin tráfico reciente que debe marcarse como candidata a deprecación, no eliminarse todavía.**

El siguiente paso de inventario es completar la misma matriz para App API v1/v2/v3, Memory/MCP y los planners/runners/supervisors legacy.



## 0.5b — App API / Memory: tráfico reciente

Ventana auditada: 2026-09-28 12:30–15:00 UTC.

- `aria-app-api-v3` v104: **251 llamadas**.
- `aria-app-api-v1`: **0 observadas**.
- `aria-app-api-v2`: **0 observadas**.
- `aria-memory-v2` v33: **141 llamadas**.
- `aria-memory-bridge-v1`: **0 observadas**.
- `aria-memory-bridge-9-4`: **0 observadas**.

**Clasificación:** v3/v2 son superficies activas demostradas. Las demás variantes son candidatos de legacy/deprecación sujetos a auditoría de consumidores y rollback. No se elimina ninguna en FASE 0.



## 0.5c — MCP/OAuth legacy traffic audit

Ventana auditada: 2026-09-28 12:30–15:00 UTC.

Las **16 variantes `aria-mcp-*` activas** no mostraron llamadas en `function_edge_logs` durante la ventana auditada, incluyendo server/gateway/oauth históricos y variantes Grok.

**Clasificación:** no hay evidencia de uso reciente del conjunto MCP en esta ventana. Esto es suficiente para crear una lista de candidatos a deprecación, pero **no** para eliminarlos: todavía falta comprobar consumidores externos y la ruta MCP que debe certificarse en la fase operacional.

