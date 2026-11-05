'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const meditationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-meditation-notepad-'));
process.env.ARIA_MEDITATION_ROOT = meditationRoot;
process.env.ARIA_MEDITATION_AUTO_RESUME = 'false';
process.env.ARIA_MEDITATION_PORT = String(42000 + (process.pid % 10000));

const {
  createWindowsMeditationController,
  openNotepad,
  constants
} = require('../agents/windows/aria-meditation-controller');

test('Notepad ENOENT is handled as an optional UI failure, not an unhandled child-process error', async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.unref = () => {};
  const pending = openNotepad({
    executable: 'notepad.exe',
    existsSync: () => true,
    spawnImpl: () => {
      process.nextTick(() => {
        const error = new Error('spawn notepad.exe ENOENT');
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    }
  });

  const result = await pending;
  assert.deepEqual(result, {
    status: 'unavailable',
    error: 'notepad_spawn_failed:ENOENT'
  });
});

test('missing absolute Notepad executable does not attempt to spawn', async () => {
  let spawnCalled = false;
  const result = await openNotepad({
    executable: 'C:\\Windows\\System32\\notepad.exe',
    existsSync: () => false,
    spawnImpl: () => {
      spawnCalled = true;
      throw new Error('spawn must not be called');
    }
  });

  assert.deepEqual(result, {
    status: 'unavailable',
    error: 'notepad_executable_not_found'
  });
  assert.equal(spawnCalled, false);
});

test('Meditation controller remains startable when its optional Notepad editor is unavailable', async () => {
  const controller = createWindowsMeditationController({
    openNotepadImpl: async () => ({
      status: 'unavailable',
      error: 'notepad_spawn_failed:ENOENT'
    })
  });

  try {
    const result = await controller.start();
    assert.equal(result.status, 'started');
    await new Promise(resolve => setTimeout(resolve, 50));

    const log = fs.readFileSync(constants.LOG_PATH, 'utf8');
    assert.match(log, /NOTEPAD_UNAVAILABLE reason=notepad_spawn_failed:ENOENT/);
    assert.match(log, /START session=/);
  } finally {
    await controller.shutdown();
    fs.rmSync(meditationRoot, { recursive: true, force: true });
  }
});

test('Notepad spawn success resolves after the spawn event and detaches the UI process', async () => {
  const child = new EventEmitter();
  child.pid = 9876;
  let unrefCalled = false;
  child.unref = () => { unrefCalled = true; };

  const pending = openNotepad({
    executable: 'notepad.exe',
    existsSync: () => true,
    spawnImpl: () => {
      process.nextTick(() => child.emit('spawn'));
      return child;
    }
  });

  const result = await pending;
  assert.deepEqual(result, { status: 'started', pid: 9876 });
  assert.equal(unrefCalled, true);
});


test('Windows preflight preserves shell.execute and keeps local Qwen tests opt-in', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-windows-agent-preflight.yml'), 'utf8');
  const qwenGate = "if: vars.ARIA_WINDOWS_AGENT_QWEN_PREFLIGHT == 'true'";
  const qwenGateCount = workflow.split(qwenGate).length - 1;
  assert.equal(qwenGateCount, 3, 'Ollama restart/service/generation checks must all be opt-in');
  assert.ok(workflow.includes('LIVE_AGENT_STATE=RECOVERY_REQUIRED'));
  assert.ok(workflow.includes("capabilities = @('shell.execute','computer.use','computer.use.autonomous')"));
  assert.ok(workflow.includes('Gateway heartbeat response dropped shell.execute'));
  assert.ok(!workflow.includes("capabilities = @('ollama.qwen3')"));
});
