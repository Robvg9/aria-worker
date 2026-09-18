'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Meditation IA desktop surface uses the existing local control API', () => {
  const ui = read('agents/windows/aria-meditation-ui.ps1');
  const controller = read('agents/windows/aria-meditation-controller.js');
  for (const route of ['/status', '/log', '/start', '/pause', '/resume', '/stop']) assert.ok(ui.includes(route), `UI route missing: ${route}`);
  for (const route of ['/status', '/log', '/start', '/pause', '/resume', '/stop']) assert.ok(controller.includes(route), `controller route missing: ${route}`);
  assert.ok(ui.includes('ARIA - MEDITACION IA') || ui.includes('ARIA — MEDITACIÓN IA'));
  assert.ok(ui.includes('ACTIVAR'));
  assert.ok(ui.includes('PAUSAR'));
  assert.ok(ui.includes('CONTINUAR'));
  assert.ok(ui.includes('DETENER'));
  assert.ok(ui.includes('.Tag'));
});

test('Meditation IA surface exposes live mission telemetry', () => {
  const ui = read('agents/windows/aria-meditation-ui.ps1');
  assert.ok(ui.includes('PROGRESO:'));
  assert.ok(ui.includes('RUNTIME:'));
  assert.ok(ui.includes('Fabrica:'));
  assert.ok(ui.includes('candidatos'));
  assert.ok(ui.includes('Aprendizaje:'));
  assert.ok(ui.includes('Proxima accion:'));
  assert.ok(ui.includes('Ultimo:'));
});

test('Meditation IA launcher does not create a second runtime', () => {
  const launcher = read('scripts/windows/start-meditation-ia.ps1');
  assert.ok(launcher.includes('Runtime\\windows\\run-agent.ps1'));
  assert.ok(launcher.includes('127.0.0.1:$Port'));
  assert.ok(launcher.includes('aria-meditation-ui.ps1'));
  assert.equal((launcher.match(/Start-Process/g) || []).length, 1, 'launcher must only start the existing watchdog when needed');
});

test('Meditation IA installer publishes the control surface and launcher', () => {
  const installer = read('scripts/windows/install-meditation-ia.ps1');
  assert.ok(installer.includes('aria-meditation-ui.ps1'));
  assert.ok(installer.includes('start-meditation-ia.ps1'));
  assert.ok(installer.includes('CreateShortcut'));
  assert.ok(installer.includes('.lnk'));
  assert.ok(installer.includes('ARIA_MEDITATION_INSTALL=PASS'));
  assert.ok(installer.includes('Description='));
});

console.log('MEDITATION IA DESKTOP SURFACE: PASS');


test('Meditation IA center exposes catalog, queue and Human Gate UI', () => {
  const ui = read('agents/windows/aria-meditation-ui.ps1');
  const controller = read('agents/windows/aria-meditation-controller.js');
  for (const route of ['/catalog','/queue','/queue/add','/queue/remove','/queue/reorder','/queue/run-next']) {
    assert.ok(ui.includes(route), 'UI center route missing: ' + route);
    assert.ok(controller.includes(route), 'controller center route missing: ' + route);
  }
  for (const marker of ['CATÁLOGO','COLA MANUAL','AGREGAR A COLA','EJECUTAR SIGUIENTE','NO EXISTE MISION HUMANA','RESULTADO:','SOLUCIÓN:','MEJORA ARIA:']) {
    assert.ok(ui.includes(marker), 'UI marker missing: ' + marker);
  }
});

test('Meditation IA verification surface exposes a real Human Gate confirmation path', () => {
  const ui = read('agents/windows/aria-meditation-ui.ps1');
  const controller = read('agents/windows/aria-meditation-controller.js');
  const gateway = read('supabase/functions/aria-device-gateway/index.ts');
  const runner = read('supabase/functions/aria-mission-runner-v22/index.ts');
  assert.ok(ui.includes('CONFIRMAR HUMAN GATE'));
  assert.ok(controller.includes('/human-gate/complete'));
  assert.ok(gateway.includes('/v1/meditation/human-gate/complete'));
  assert.ok(gateway.includes('NO EXISTE MISION HUMANA'));
  assert.ok(runner.includes('status: "human_gate_required"'));
  assert.ok(runner.includes('realHumanGate'));
});
