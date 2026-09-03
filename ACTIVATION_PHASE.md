# ARIA — Fase de Activación e Integración Real

Version: 2.4.0
Estado: PR de preparación para auditoría; **no merge** en esta fase.

## Objetivo

Convertir los conectores y límites ya implementados en una superficie operativa real y observable, sin saltarse Router, Fallback, Execution, Governance, Credential Boundary ni Memory Authority.

## Conectores objetivo

- GitHub — API/Actions; lectura y operaciones de escritura mediante permisos explícitos.
- Supabase — Management API para proyectos, migraciones y logs; ejecución limitada por token/scopes.
- Cloudflare — API de Workers, versiones/deployments y observabilidad.
- Notion / ChatBending — API para lectura/búsqueda/escrituras gobernadas.
- Web — fetch/search mediante transporte del host.
- Filesystem — operaciones del workspace mediante runtime anfitrión.
- Image/Multimedia — operaciones mediante adapters de proveedores/modelos; no se inventa un endpoint fijo.

## Credenciales

Los conectores externos usan referencias canónicas `secret://provider/account`. El resolver de activación traduce únicamente esas referencias a variables de entorno de runtime (`ARIA_SECRET_<PROVIDER>_<ACCOUNT>`), devuelve el secreto solo al consumidor inmediato y nunca lo incorpora al snapshot, diagnóstico, logs o documentación.

## Estados

`unconfigured → configured → healthy | degraded | unavailable`, con `disabled` explícito. La ausencia de credenciales nunca se transforma en salud ficticia.

## Flujo operativo

1. Cargar manifest/configuración.
2. Validar referencias y contratos.
3. Comprobar configuración/credenciales sin exponer material secreto.
4. Ejecutar health probe del adapter.
5. Registrar estado y capabilities disponibles.
6. Seleccionar herramienta/ruta mediante las capas ya existentes.
7. Obtener autorización vinculada a request/execution/tool/operation/risk.
8. Resolver credential_ref justo antes de la llamada.
9. Ejecutar una única operación mediante adapter.
10. Sanear resultados antes de exponerlos.
11. Emitir observabilidad segura.
12. Verificar resultado y estado posterior cuando la operación lo requiera.

## Reglas de seguridad

- No hay secretos en repositorio.
- No hay auto-aprobación.
- `selected` no equivale a `approved`.
- Health `unknown` no equivale a `healthy`.
- No se permite account hopping implícito.
- No se permite bypass de Governance.
- Las operaciones destructivas requieren verificación humana cuando la policy lo exija.
- El runtime de activación no despliega silenciosamente ni activa proveedores externos por su cuenta.
- El modo live depende de credenciales y configuración reales suministradas en el entorno de ejecución.

## Smoke tests

`npm run test:activation` ejecuta pruebas con transports simulados pero usando las mismas rutas, headers y contratos de los adapters LIVE. Esto valida integración sin usar secretos reales.

## Activación humana posterior al merge

Para convertir cada conector a LIVE de verdad se debe configurar su credential_ref correspondiente y ejecutar su smoke test contra el servicio real. La activación se considera completada solo cuando existe evidencia HTTP válida y el resultado coincide con el contrato esperado.

## Evidencia externa de diseño

- Supabase Management API requiere Bearer token y soporta proyectos, migraciones y logs.
- Cloudflare Workers expone API de versiones/deployments.
- GitHub REST mantiene APIs para repositorios y Actions.

Estas referencias respaldan las superficies API usadas en este runbook; la comprobación de credenciales/entorno real sigue siendo necesaria antes de cualquier operación productiva.
