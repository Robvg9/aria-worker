# ARIA 5/9 — Windows Físico — Preparación aislada

## Estado
**FASE 5/9: PREPARADA EN RAMA AISLADA.**

Rama:
`aria/phase5-windows-physical-20260930`

Regla de aislamiento:
- Esta preparación no modifica `main`.
- No hace merge.
- No dispara deploy de Cloudflare.
- No modifica ni cancela el trabajo de 3/9.
- La rama nació desde el `main` vigente al crearla.

## Objetivo canónico
Certificar físicamente la cadena:

`ARIA → execution job → Windows Local Agent → computer.use / shell.execute → resultado → evidencia persistida`

La certificación física no se cierra por contratos estáticos ni por una ejecución histórica.

## Componentes ya existentes que se reutilizan
- Windows Local Agent: `agents/windows/aria-agent.js`
- Instalador/runtime: `agents/windows/install-v2.ps1`
- Computer Use Adapter: `computer-use/windows-desktop-adapter.js`
- Desktop Runner: `computer-use/windows-desktop-runner.ps1`
- Physical E2E: `tests/windows-desktop-physical-e2e.js`
- Autonomous RWHT Controller: `agents/windows/autonomous-rwht-controller.js`
- Contract tests: `tests/windows-computer-use.test.js`, `tests/computer-use-runtime-v1.test.js`, `tests/autonomous-windows-rwht-controller.test.js`

## Preflight antes del Human Gate
1. Confirmar que el Windows está disponible.
2. Confirmar dispositivo canónico:
   `windows-fe722cc6681e4f9c9cc35f5ebbb0a089`
3. Confirmar agente `aria-windows-agent-v2`.
4. Confirmar capabilities: `shell.execute`, `computer.use`, `computer.use.autonomous`.
5. Confirmar que el runtime instalado en `D:\\ARIA-Windows-Agent\\Runtime\\windows` coincide con el código de esta rama.
6. Ejecutar la batería contractual sin cambiar `main`.

## Certificación física prevista
### A. Shell
Ejecutar una misión mínima de `shell.execute` y exigir:
- job reclamado por Windows;
- exit_code = 0;
- stdout con marcador único;
- resultado persistido.

### B. Computer Use
Sobre el Windows real:
- screenshot;
- observe;
- open;
- focus;
- type;
- keypress;
- hotkey;
- move;
- click;
- double_click;
- drag;
- scroll;
- wait.

### C. Navegador
Sobre Chrome real:
- abrir/focalizar Chrome;
- navegación a la PWA LIVE;
- observe;
- interacción semántica cuando corresponda;
- verificación posterior.

### D. Recovery
Provocar una única falla controlada y comprobar:
- timeout/fallo clasificado;
- job no queda colgado indefinidamente;
- recuperación posterior;
- observe después de recovery;
- evidencia persistida.

## Gate de cierre
Fase 5/9 solo puede pasar a PASS cuando exista evidencia reciente y persistida del Windows físico sobre el build/código que se esté certificando, incluyendo:
- dispositivo identificado;
- job/misión;
- acciones ejecutadas;
- acciones verificadas;
- resultado terminal;
- evidencia;
- recovery, si aplica;
- ausencia de errores críticos;
- versión/runtime observado.

Un PASS de contrato o una ejecución histórica no sustituye este gate.

## Integración posterior
Cuando Robert confirme que Codex ya no está trabajando sobre 3/9:
1. actualizar esta rama desde el `main` vigente, si procede;
2. ejecutar preflight;
3. ejecutar certificación física;
4. revisar evidencia;
5. crear PR hacia `main`;
6. no hacer merge hasta conservar el estado de 3/9 de forma compatible.

## Nota de seguridad operativa
No ejecutar desde esta rama cambios destinados a despliegue productivo mientras 3/9 esté siendo modificado por otro agente.
