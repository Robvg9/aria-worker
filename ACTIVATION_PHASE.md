# ARIA — Fase de Activación e Integración Real

Version: 2.4.2
Estado: PR de preparación para merge; **no merge** hasta completar CI final.

## Objetivo

Convertir los conectores y límites ya implementados en una superficie operativa real y observable, sin saltarse Router, Fallback, Execution, Governance, Credential Boundary ni Memory Authority.

## Conectores objetivo

- GitHub — API/Actions; lectura y operaciones de escritura mediante permisos explícitos.
- Supabase — Management API para proyectos, consultas de solo lectura, migraciones, logs y Edge Functions.
- Cloudflare — API de Workers, contenido, versiones/deployments y observabilidad mediante Tails.
- Notion / ChatBending — API para lectura/búsqueda/escrituras gobernadas.
- Web — fetch mediante transporte del host.
- Filesystem — operaciones del workspace mediante runtime anfitrión explícitamente inyectado.
- Image/Multimedia — operaciones mediante provider runtime explícitamente inyectado.

## Credenciales

Los conectores externos usan referencias canónicas `secret://provider/account`. El resolver de activación traduce únicamente esas referencias a variables de entorno de runtime (`ARIA_SECRET_<PROVIDER>_<ACCOUNT>`), devuelve el secreto solo al consumidor inmediato y nunca lo incorpora al snapshot, diagnóstico, logs o documentación.

## Estados

`unconfigured → configured → healthy | degraded | unavailable`, con `disabled` explícito. La ausencia de credenciales nunca se transforma en salud ficticia. Los runtimes de host/provider tampoco se consideran saludables hasta que exponen su health contract.

## Flujo operativo

1. Cargar manifest/configuración.
2. Validar referencias, proveedor y origen permitido.
3. Comprobar configuración/credenciales sin exponer material secreto.
4. Ejecutar health probe del adapter.
5. Registrar estado y capabilities disponibles.
6. Seleccionar herramienta/ruta mediante las capas ya existentes.
7. Obtener autorización vinculada a connector, operation, risk y parámetros de destino.
8. Resolver credential_ref justo antes de la llamada.
9. Ejecutar una única operación mediante adapter.
10. Sanear resultados, incluyendo coincidencias exactas del secreto resuelto.
11. Emitir observabilidad segura.
12. Verificar resultado y estado posterior cuando la operación lo requiera.

## Reglas de seguridad

- No hay secretos en repositorio.
- No hay auto-aprobación.
- `selected` no equivale a `approved`.
- Health `unknown` no equivale a `healthy`.
- Un adapter con credenciales no puede redirigirse a un origen arbitrario: GitHub, Supabase, Cloudflare y Notion usan allowlist de origen.
- La clasificación de riesgo se declara por operación en el adapter; el caller no puede rebajarla.
- La autorización recibe parámetros de destino relevantes para impedir decisiones ciegas sobre repositorios, proyectos, cuentas, scripts o páginas.
- No se permite account hopping implícito.
- No se permite bypass de Governance.
- Las operaciones de escritura de alto riesgo requieren autorización explícita; las destructivas siguen sujetas a la policy de Governance.
- El runtime de activación no despliega silenciosamente ni activa proveedores externos por su cuenta.
- El modo live depende de credenciales y configuración reales suministradas en el entorno de ejecución.

## Smoke tests

`npm run test:activation` ejecuta pruebas con transports simulados pero usando las mismas rutas, headers y contratos de los adapters LIVE.

La suite también verifica: cobertura de risk contracts, rechazo de downgrade de riesgo, codificación Base64 de GitHub Contents, bloqueo por origen no confiable, redacción exacta de secretos y bootstrap de todas las piezas del Core.

## Activación humana posterior al merge

Para convertir cada conector a LIVE de verdad se debe configurar su credential_ref correspondiente y ejecutar su smoke test contra el servicio real. La activación se considera completada solo cuando existe evidencia HTTP válida y el resultado coincide con el contrato esperado.

No se deben copiar tokens a código, commits, issues, logs ni ChatBending.

## Evidencia externa verificada durante la auditoría

- GitHub REST documenta Contents create/update, Git refs y workflow dispatch.
- Supabase Management API documenta read-only SQL, migrations, logs y Edge Functions.
- Cloudflare API documenta Worker content, versions, deployments y Tails.
- Notion API documenta creación y actualización de contenido Markdown de páginas.

La integración real sigue dependiendo de los permisos/scopes concretos del token y de la configuración del entorno; los smoke tests del repositorio no sustituyen una prueba contra las cuentas reales.
