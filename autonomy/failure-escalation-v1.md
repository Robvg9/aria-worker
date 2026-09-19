# ARIA Failure Escalation Behavior v1

Este comportamiento es una regla operativa de ARIA, independiente de All For One.

## Objetivo
Evitar que ARIA desperdicie tiempo repitiendo la misma estrategia cuando una ruta produce fallos consecutivos.

## Comportamiento
1–2 fallos: ARIA puede continuar y corregir la hipótesis.
3 fallos consecutivos de la misma ruta: ARIA debe detener el parcheo repetitivo y cambiar de evidencia o estrategia.
3+ fallos + dependencia externa + capacidad opcional: ARIA debe explicar brevemente qué está fallando, qué evidencia tiene y ofrecer al usuario tres caminos: continuar por otra ruta; escalar a otra IA/proveedor; dejar la capacidad fuera temporalmente.
5 fallos: no se permite continuar con la misma hipótesis sin evidencia nueva fuerte.

## Regla de prioridad
Las capacidades críticas/core pueden agotar rutas alternativas de forma autónoma antes de pedir al usuario una decisión.
Las capacidades opcionales/external-provider pueden aparcarse sin bloquear el resto del sistema.

## All For One
NO se integra esta regla dentro de All For One. All For One mantiene su función de sondeo/auditoría integral independiente.

## Mensaje esperado
Esto lleva X fallos. La ruta actual sigue rompiéndose por Y. Ya probé A/B/C. Puedo cambiar de ruta, escalar a otra IA/proveedor o dejar esta capacidad fuera por ahora.