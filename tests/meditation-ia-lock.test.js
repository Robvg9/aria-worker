'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { createFileStateStore, createMeditationController } = require('../autonomy/meditation-ia-controller');

function mkRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aria-med-lock-'));
}

async function writeLock(root, pid, extra = {}) {
  const lockPath = path.join(root, 'controller.lock');
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(lockPath, JSON.stringify({ pid, acquired_at: new Date().toISOString(), ...extra }), 'utf8');
  return lockPath;
}

(async () => {
  // Caso A — ningún lock → START active
  {
    const root = mkRoot();
    const store = createFileStateStore({ root_dir: root });
    const events = [];
    const controller = createMeditationController({
      stateStore: store,
      commandSource: { async read() { return { entries: [], next_offset: 0 }; } },
      log: async (m) => events.push(m),
      requestTick: async () => ({ ok: true, status: 'idle' }),
      checkpoint: async (r) => r,
      isUserIdle: async () => true,
      ensureNotepad: async () => {},
      heartbeat_ms: 60000,
      min_idle_seconds: 0
    });
    const r = await controller.start();
    assert.equal(r.status, 'started');
    assert.equal(controller.status().mode, 'active');
    assert.ok(controller.status().session_id);
    await controller.shutdown();
    assert.ok(!fs.existsSync(path.join(root, 'controller.lock')), 'lock released after shutdown');
    console.log('CASE_A_no_lock=PASS');
  }

  // Caso B — lock huérfano (PID muerto)
  {
    const root = mkRoot();
    await writeLock(root, 999999991);
    const store = createFileStateStore({ root_dir: root });
    const controller = createMeditationController({
      stateStore: store,
      commandSource: { async read() { return { entries: [], next_offset: 0 }; } },
      log: async () => {},
      requestTick: async () => ({ ok: true, status: 'idle' }),
      checkpoint: async (r) => r,
      isUserIdle: async () => true,
      ensureNotepad: async () => {},
      heartbeat_ms: 60000,
      min_idle_seconds: 0
    });
    const r = await controller.start();
    assert.equal(r.status, 'started', 'orphan lock must be reclaimed');
    assert.equal(controller.status().mode, 'active');
    await controller.shutdown();
    console.log('CASE_B_orphan_lock=PASS');
  }

  // Caso C — otro proceso vivo (pid 1 / systemd always live; EPERM treated as alive)
  {
    const root = mkRoot();
    await writeLock(root, 1);
    const store = createFileStateStore({ root_dir: root });
    const ok = await store.acquireLock();
    assert.equal(ok, false, 'live foreign pid must reject acquire');
    console.log('CASE_C_live_foreign=PASS');
  }

  // Caso D — PID reutilizado / same process pid in lock
  {
    const root = mkRoot();
    await writeLock(root, process.pid, { note: 'stale_same_pid' });
    const store = createFileStateStore({ root_dir: root });
    const ok = await store.acquireLock();
    assert.equal(ok, true, 'same-pid lock must be reclaimed (PID reuse / crash without release)');
    const lock = JSON.parse(await fsp.readFile(path.join(root, 'controller.lock'), 'utf8'));
    assert.equal(lock.pid, process.pid);
    assert.equal(lock.reclaimed, true);
    assert.equal(lock.reason, 'same_pid');
    await store.releaseLock();
    console.log('CASE_D_same_pid_reuse=PASS');
  }

  // Caso E — restart simulation: start → shutdown → start again
  {
    const root = mkRoot();
    const store = createFileStateStore({ root_dir: root });
    const make = () => createMeditationController({
      stateStore: store,
      commandSource: { async read() { return { entries: [], next_offset: 0 }; } },
      log: async () => {},
      requestTick: async () => ({ ok: true, status: 'idle' }),
      checkpoint: async (r) => r,
      isUserIdle: async () => true,
      ensureNotepad: async () => {},
      heartbeat_ms: 60000,
      min_idle_seconds: 0
    });
    const c1 = make();
    assert.equal((await c1.start()).status, 'started');
    await c1.shutdown();
    const c2 = make();
    assert.equal((await c2.start()).status, 'started');
    assert.equal(c2.status().mode, 'active');
    await c2.shutdown();
    console.log('CASE_E_restart=PASS');
  }

  // Caso F — CERRAR libera lock
  {
    const root = mkRoot();
    const store = createFileStateStore({ root_dir: root });
    const controller = createMeditationController({
      stateStore: store,
      commandSource: { async read() { return { entries: [], next_offset: 0 }; } },
      log: async () => {},
      requestTick: async () => ({ ok: true, status: 'idle' }),
      checkpoint: async (r) => ({ status: 'saved', ...r }),
      isUserIdle: async () => true,
      ensureNotepad: async () => {},
      heartbeat_ms: 3600000,
      min_idle_seconds: 0
    });
    const started = await controller.start();
    assert.equal(started.status, 'started');
    assert.ok(fs.existsSync(path.join(root, 'controller.lock')));
    const stop = await controller.stop();
    assert.equal(stop.status, 'stopped');
    await new Promise(r => setTimeout(r, 100));
    assert.ok(!fs.existsSync(path.join(root, 'controller.lock')), 'CERRAR must release lock');
    const again = await controller.start();
    assert.equal(again.status, 'started');
    await controller.shutdown();
    await new Promise(r => setTimeout(r, 50));
    console.log('CASE_F_cerrar_releases=PASS');
  }

  // Caso G — invalid / garbage lock content
  {
    const root = mkRoot();
    await writeLock(root, 'abc');
    const store = createFileStateStore({ root_dir: root });
    const ok = await store.acquireLock();
    assert.equal(ok, true, 'invalid pid must be reclaimed');
    await store.releaseLock();
    console.log('CASE_G_invalid_lock=PASS');
  }

  console.log('MEDITATION_IA_LOCK_TESTS=PASS');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
