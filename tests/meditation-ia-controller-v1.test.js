'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createFileStateStore, createMeditationController, VERSION } = require('../autonomy/meditation-ia-controller');
const { createWindowsMeditationController } = require('../agents/windows/aria-meditation-controller');

assert.equal(VERSION, 'aria-meditation-ia-v1');
assert.equal(typeof createFileStateStore, 'function');
assert.equal(typeof createMeditationController, 'function');
assert.equal(typeof createWindowsMeditationController, 'function');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-meditation-'));
  const store = createFileStateStore({ root_dir: root });
  const writes = [];
  const log = async message => { writes.push(message); };
  const controller = createMeditationController({
    stateStore: store,
    commandSource: { read: async () => ({ entries: [] }) },
    log,
    requestTick: async ({ tick }) => ({ status: 'idle', tick }),
    checkpoint: async record => ({ status: 'checkpointed', record }),
    isUserIdle: async () => true,
    ensureNotepad: async () => {},
    onModeChange: async () => {},
    onMissionEvent: async () => {},
    heartbeat_ms: 10000,
    min_idle_seconds: 0
  });

  const first = await controller.start();
  assert.equal(first.status, 'started');
  assert.equal(controller.status().version, 'aria-meditation-ia-v1');
  assert.equal(controller.status().mode, 'active');
  const t0 = controller.status().tick_count;
  let tickResult = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    tickResult = await controller.tick('test');
    if (tickResult.status !== 'busy') break;
    await sleep(10);
  }
  assert.notEqual(tickResult?.status, 'busy');
  assert.ok(controller.status().tick_count > t0);
  assert.equal(controller.status().last_result.status, 'idle');

  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    await sleep(50);
    fs.writeFileSync(path.join(root, 'controller.lock'), JSON.stringify({ pid: foreign.pid, acquired_at: new Date().toISOString() }), 'utf8');
    const competingStore = createFileStateStore({ root_dir: root });
    const competing = createMeditationController({
      stateStore: competingStore,
      commandSource: { read: async () => ({ entries: [] }) },
      log,
      requestTick: async () => ({ status: 'idle' }),
      checkpoint: async record => ({ status: 'checkpointed', record }),
      isUserIdle: async () => true,
      ensureNotepad: async () => {},
      onModeChange: async () => {},
      onMissionEvent: async () => {},
      heartbeat_ms: 10000,
      min_idle_seconds: 0
    });
    const locked = await competing.start();
    assert.equal(locked.status, 'locked');
  } finally {
    foreign.kill();
    await sleep(20);
    await controller.stop();
  }

  fs.writeFileSync(path.join(root, 'controller.lock'), JSON.stringify({ pid: 2147483647, acquired_at: new Date().toISOString() }), 'utf8');
  const recovered = createFileStateStore({ root_dir: root });
  assert.equal(await recovered.acquireLock(), true);
  assert.equal(JSON.parse(fs.readFileSync(recovered.lockPath, 'utf8')).reclaimed, true);
  await recovered.releaseLock();

  console.log('MEDITATION_IA_CONTROLLER_V1_OK');
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
