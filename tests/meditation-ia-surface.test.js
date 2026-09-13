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
  assert.ok(ui.includes('ARIA — MEDITACIÓN IA'));
  assert.ok(ui.includes('ACTIVAR'));
  assert.ok(ui.includes('PAUSAR'));
  assert.ok(ui.includes('CONTINUAR'));
  assert.ok(ui.includes('DETENER'));
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
  assert.ok(installer.includes('ARIA — Meditación IA.lnk'));
  assert.ok(installer.includes('ARIA_MEDITATION_INSTALL=PASS'));
});

console.log('MEDITATION IA DESKTOP SURFACE: PASS');
