'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileStateStore, createMeditationController, fingerprintMission } = require('../autonomy/meditation-ia-controller');
const { createMeditationPolicy, autonomousActionAllowed } = require('../autonomy/meditation-ia-policy');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-meditation-'));
  const events = [];
  let commands = [];
  let tickCalls = 0;
  let checkpoints = 0;
  const store = createFileStateStore({ root_dir: root });
  const controller = createMeditationController({
    stateStore: store,
    commandSource: { async read(offset) { const entries = commands.map(command => ({ command, next_offset: offset + command.length + 1 })); commands = []; return { entries, next_offset: entries.at(-1)?.next_offset ?? offset }; } },
    log: async message => events.push(message),
    requestTick: async ({ tick }) => { tickCalls += 1; return { ok: true, status: 'idle', tick }; },
    checkpoint: async record => { checkpoints += 1; return { status: 'saved', ...record }; },
    isUserIdle: async () => true,
    ensureNotepad: async () => events.push('NOTEPAD'),
    now: () => new Date(100000)
  });
  assert.equal(fingerprintMission('  Abre  PowerShell '), 'abre powershell');
  const policy = createMeditationPolicy();
  assert.equal(policy.heartbeat_ms, 30000);
  assert.equal(autonomousActionAllowed({ risk: 'low' }, policy).allowed, true);
  assert.equal(autonomousActionAllowed({ risk: 'critical' }, policy).allowed, false);
  assert.equal(autonomousActionAllowed({ production_merge: true, risk: 'low' }, policy).allowed, false);
  assert.equal((await controller.start()).status, 'started');
  assert.equal(controller.status().mode, 'active');
  await controller.tick('test');
  assert.equal(tickCalls, 1);
  commands = ['PAUSA']; await controller.tick('command'); assert.equal(controller.status().mode, 'paused');
  commands = ['AVANZA']; await controller.tick('command'); assert.equal(controller.status().mode, 'active');
  commands = ['ESTADO']; await controller.tick('command'); assert.ok(events.some(line => line.includes('STATUS')));
  commands = ['CERRAR']; await controller.tick('command'); assert.equal(controller.status().mode, 'stopped'); assert.ok(checkpoints >= 1);
  await controller.shutdown();
  console.log('MEDITATION IA CORE TEST: PASS');
  console.log(JSON.stringify({ version: controller.version, tickCalls, checkpoints, events: events.length }));
})().catch(error => { console.error(error); process.exit(1); });
