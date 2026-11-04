# Mission Wonder 2 — Paso 4/10 — A4: identidad canónica e idempotencia PWA

## Alcance de este slice

- Mantener `aria_internal.mission_state` como única fuente canónica de identidad de misión para la PWA.
- En un reintento con `request_id` existente, comprobar propietario, request ID, objetivo normalizado y proyecto antes de devolver la misión existente.
- Si el mismo request ID llega con otro objetivo/proyecto, responder HTTP 409 y no volver a invocar DIRECT.
- Aplicar la misma comprobación a la reconciliación después de un timeout/acknowledgement ambiguo.
- Conservar compatibilidad con filas históricas que no llevan un objeto de identidad versionado, usando los campos canónicos ya persistidos.

## Límites de seguridad

- `MISSION_EXECUTION_PAUSED=true` se conserva.
- No se crea misión, job ni lease LIVE.
- No se cambia el coordinator, Durable Object store, tareas Windows, crons, Supabase schema ni secretos.
- No se habilita autonomía general ni se reutiliza el scope sintético de Gate 3.

## Aceptación de este slice

1. El mismo request/owner/goal/project puede recuperar el mismo mission_id.
2. Un objetivo diferente con el mismo request ID se rechaza.
3. Un proyecto diferente con el mismo request ID se rechaza.
4. Un propietario o request ID diferente se rechaza.
5. La ruta de recuperación por respuesta ambigua aplica el mismo fence.
6. Node contract tests pasan.

## Lo que este slice NO certifica

No cierra el Paso 4/10 completo. Siguen pendientes la vinculación probada planner → canonical mission/job/lease, evidencia, verificador independiente, reconciliación de eventos/progreso, notificación PWA y una única misión LIVE acotada con objetivo real aportado por el usuario, tras gates específicos.
