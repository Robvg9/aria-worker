# Projects + ARTIA RWHT — investigación de Auth 504
Fecha: 2026-10-09 (UTC)

## Problema confirmado
El run [37875386646](https://github.com/Robvg9/aria-worker/actions/runs/37875386646) se detuvo antes de abrir la superficie Projects. El reporte del artefacto `aria-projects-rwht-evidence` documenta:

- `auth_verified=false`
- `project_count=0`
- `failure=auth_provider_unavailable_no_login_form_after_api_recovery`
- Tres respuestas HTTP 504 en `POST /auth/token?grant_type=refresh_token`
- Las llamadas de lectura a `/api/*` recibieron 401 porque no existía una sesión válida.

Esto **no prueba un fallo de las vistas previas**: la prueba no llegó a verificar proyectos, ARTIA, dibujo ni persistencia de misiones.

## Recuperación ejecutada
Workflow existente: [ARIA Supabase Auth Recovery Restart](https://github.com/Robvg9/aria-worker/blob/main/.github/workflows/aria-supabase-auth-recovery-restart.yml)

Run de recuperación: [37875862835](https://github.com/Robvg9/aria-worker/actions/runs/37875862835)

Evidencia en los logs del job `restart-and-health`:
- `SUPABASE_RESTART_REQUESTED`
- `PROJECT_STATUS=ACTIVE_HEALTHY`
- `SUPABASE_ACTIVE_HEALTHY`

## Regla de cierre
El reinicio y `ACTIVE_HEALTHY` **no certifican la fase**. Hay que ejecutar Projects + ARTIA Browser RWHT contra el SHA exacto desplegado después de la recuperación y exigir:

1. Autenticación real y lecturas API autorizadas.
2. Catálogo ARIA, CuevaCoin y BattleCruiser.
3. Previsualización visible en Resumen de cada proyecto y fuente correcta.
4. ARTIA carga cada superficie; LIVE y referencia de código se etiquetan sin engaño.
5. Trazo real sobre el canvas, tres misiones visuales con `mission_id`, lectura canónica del detalle, anotaciones PNG persistidas, proyecto/contexto correctos.
6. Las misiones creadas por el test quedan en estado terminal verificado, sin trabajos de certificación abandonados en la cola.
7. Artefacto E2E con `verified=true`, evidencia persistida, sin errores propios de página/consola ni respuestas internas fallidas.

## Evidencia relacionada
- [Último RWHT fallido por Auth 504 (37875386646)](https://github.com/Robvg9/aria-worker/actions/runs/37875386646)
- [Workflow Projects + ARTIA](https://github.com/Robvg9/aria-worker/blob/main/.github/workflows/projects-rwht-authenticated.yml)
- [Issue de certificación y reportes persistidos](https://github.com/Robvg9/aria-worker/issues/1011)

Estado al crear este documento: **RECUPERACIÓN DE INFRAESTRUCTURA PASS; E2E Projects + ARTIA POST-RECUPERACIÓN PENDIENTE**. No proclamar 100% hasta el E2E final.
