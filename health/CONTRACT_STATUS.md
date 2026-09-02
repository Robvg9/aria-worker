# MISIÓN 10.11 — HEALTH / AVAILABILITY MANAGER

**Estado: DESIGN CONTROLLED — IMPLEMENTADO / PROBADO EN LABORATORIO**

## Alcance

Health / Availability Manager declarativo. Representa evidencia observada o desconocida sobre provider/model/account sin realizar probes LIVE.

## Autoridad y límites

- `unknown` es el estado seguro por defecto cuando no existe observación.
- La metadata de Provider/Model/Account no prueba disponibilidad LIVE.
- Health/availability no concede permiso de ejecución.
- No modifica quota/capacity, routing, fallback ni memory.
- No resuelve credenciales ni realiza llamadas de red.

## Implementación

- `health/contract.md` — contrato controlado.
- `health/registry.json` — seed evidenciado con health y availability `unknown`.
- `health/lookup.js` — lookups puros.
- `tests/health-availability.test.js` — pruebas de invariantes.

## Verificación

La suite de 10.11 se ejecuta como pruebas puras sobre el código del módulo y obtuvo **8/8 PASS, 0 FAIL**.

El entorno no realiza probes LIVE ni convierte `unknown` en `available`/`healthy` por inferencia.

## Próxima evolución

Una futura capa operativa podrá incorporar observaciones reales si existe un contrato y mecanismo de evidencia autorizados. Esta misión no activa esa capa.
