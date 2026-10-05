# ARIA ABSORB — Definition of Done

ARIA ABSORB usa una única regla de completitud: una absorción solo puede reportar COMPLETE y 100% cuando pasan todos los gates obligatorios.

## Gates obligatorios

1. source_locked — commit SHA y digest SHA-256 válidos.
2. inventory_complete — árbol completo y determinista.
3. scope_defined — alcance explícito de capacidades o bindings objetivo.
4. target_bindings_ready — todos los bindings objetivo están habilitados.
5. security_verified — revisión de seguridad PASS.
6. contract_tested — contrato del adaptador PASS.
7. runtime_verified — ejecución LIVE verificada.
8. evidence_persisted — evidencia persistida.
9. registered — capacidad registrada.
10. enabled — capacidad habilitada.
11. learning_recorded — aprendizaje/resultado registrado.
12. use_verified — uso real posterior a la habilitación verificado.
13. monitor_ready — monitorización de degradación/deriva preparada.
14. rollback_ready — rollback/reemplazo seguro preparado.

completion_percent es informativo; no existe redondeo que pueda convertir un estado incompleto en COMPLETE.

La API y la PWA deben mostrar el resultado del mismo evaluador evaluateAbsorptionCompletion. Cualquier futura capacidad adquirida debe declarar su alcance y evidencia antes de poder alcanzar 100%.