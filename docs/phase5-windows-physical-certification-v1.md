# ARIA 5/9 â€” Windows FÃ­sico â€” PreparaciÃ³n aislada

## Estado
**FASE 5/9: CERTIFICADA PASS — evidencia física reciente.**

Rama:
`aria/phase5-windows-physical-20260930`

Regla de aislamiento:
- Esta preparaciÃ³n no modifica `main`.
- No hace merge.
- No dispara deploy de Cloudflare.
- No modifica ni cancela el trabajo de 3/9.
- La rama naciÃ³ desde el `main` vigente al crearla.

## Objetivo canÃ³nico
Certificar fÃ­sicamente la cadena:

`ARIA â†’ execution job â†’ Windows Local Agent â†’ computer.use / shell.execute â†’ resultado â†’ evidencia persistida`

La certificaciÃ³n fÃ­sica no se cierra por contratos estÃ¡ticos ni por una ejecuciÃ³n histÃ³rica.

## Componentes ya existentes que se reutilizan
- Windows Local Agent: `agents/windows/aria-agent.js`
- Instalador/runtime: `agents/windows/install-v2.ps1`
- Computer Use Adapter: `computer-use/windows-desktop-adapter.js`
- Desktop Runner: `computer-use/windows-desktop-runner.ps1`
- Physical E2E: `tests/windows-desktop-physical-e2e.js`
- Autonomous RWHT Controller: `agents/windows/autonomous-rwht-controller.js`
- Contract tests: `tests/windows-computer-use.test.js`, `tests/computer-use-runtime-v1.test.js`, `tests/autonomous-windows-rwht-controller.test.js`

## Preflight antes del Human Gate
1. Confirmar que el Windows estÃ¡ disponible.
2. Confirmar dispositivo canÃ³nico:
   `windows-fe722cc6681e4f9c9cc35f5ebbb0a089`
3. Confirmar agente `aria-windows-agent-v2`.
4. Confirmar capabilities: `shell.execute`, `computer.use`, `computer.use.autonomous`.
5. Confirmar que el runtime instalado en `D:\\ARIA-Windows-Agent\\Runtime\\windows` coincide con el cÃ³digo de esta rama.
6. Ejecutar la baterÃ­a contractual sin cambiar `main`.

## CertificaciÃ³n fÃ­sica prevista
### A. Shell
Ejecutar una misiÃ³n mÃ­nima de `shell.execute` y exigir:
- job reclamado por Windows;
- exit_code = 0;
- stdout con marcador Ãºnico;
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
- navegaciÃ³n a la PWA LIVE;
- observe;
- interacciÃ³n semÃ¡ntica cuando corresponda;
- verificaciÃ³n posterior.

### D. Recovery
Provocar una Ãºnica falla controlada y comprobar:
- timeout/fallo clasificado;
- job no queda colgado indefinidamente;
- recuperaciÃ³n posterior;
- observe despuÃ©s de recovery;
- evidencia persistida.

## Gate de cierre
Fase 5/9 solo puede pasar a PASS cuando exista evidencia reciente y persistida del Windows fÃ­sico sobre el build/cÃ³digo que se estÃ© certificando, incluyendo:
- dispositivo identificado;
- job/misiÃ³n;
- acciones ejecutadas;
- acciones verificadas;
- resultado terminal;
- evidencia;
- recovery, si aplica;
- ausencia de errores crÃ­ticos;
- versiÃ³n/runtime observado.

Un PASS de contrato o una ejecuciÃ³n histÃ³rica no sustituye este gate.

## IntegraciÃ³n posterior
Cuando Robert confirme que Codex ya no estÃ¡ trabajando sobre 3/9:
1. actualizar esta rama desde el `main` vigente, si procede;
2. ejecutar preflight;
3. ejecutar certificaciÃ³n fÃ­sica;
4. revisar evidencia;
5. crear PR hacia `main`;
6. no hacer merge hasta conservar el estado de 3/9 de forma compatible.

## Nota de seguridad operativa
No ejecutar desde esta rama cambios destinados a despliegue productivo mientras 3/9 estÃ© siendo modificado por otro agente.
