# ARIA Fase 6/9 — Android físico — Gate de certificación

## Objetivo

Cerrar la certificación física del canal Android de ARIA sobre el dispositivo canónico:

`android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092`

La fase no se considera 100% hasta completar ejecución física, evidencia persistida y la integración final en `main`.

## Gate

1. Heartbeat Android reciente y agente identificado.
2. Capacidad `computer.use.android` realmente disponible.
3. IPC local de Android UI Agent saludable:
   - `127.0.0.1:45874/health`
   - protocolo `aria-android-ui-agent-ipc-v2`
4. Ejecución física real sobre la PWA LIVE:
   `observe → acción segura → observe`.
5. Evidencia física suficiente: estado UI, hashes/evidencia y resultado persistido.
6. Recuperación física real después de una interrupción controlada del canal UI.
7. Contratos Android y transporte en PASS.
8. Cambios de esta fase integrados en `main`.

## Reglas

- Un PASS de backend, CI, smoke o mock no sustituye el Human Gate físico.
- No cerrar con un heartbeat histórico.
- No repetir una ruta fallida tres veces sin evidencia nueva; cambiar de estrategia.
- No declarar 100% antes de que el cambio certificado esté integrado en `main`.

## Situación inicial 2026-09-30

El registro de dispositivo conserva estado `online`, pero el último `last_seen_at` disponible es 2026-09-29T16:43:08Z. La fase comienza con recuperación/verificación del agente y de la ventana Android, no con un nuevo rediseño de la PWA.

## Cierre

El cierre requiere una evidencia nueva y persistida producida después de la recuperación del canal físico.