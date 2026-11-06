'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireWorkerInstanceLock } = require('../autonomy/worker-single-instance-lock-v1');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-worker-lock-test-'));
const lockPath = path.join(root, 'worker.lock');

try {
  const alive = new Set([101]);
  const first = acquireWorkerInstanceLock({
    lockPath, pid: 101, hostname: 'ROBVG', isProcessAlive: pid => alive.has(pid)
  });
  assert.equal(first.recoveredStaleLock, false);

  assert.throws(() => acquireWorkerInstanceLock({
    lockPath, pid: 202, hostname: 'ROBVG', isProcessAlive: pid => alive.has(pid)
  }), error => error && error.code === 'ARIA_WORKER_ALREADY_RUNNING' && error.exitCode === 75);
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 101, 'a duplicate cannot replace the active lock');

  alive.delete(101);
  const recovered = acquireWorkerInstanceLock({
    lockPath, pid: 202, hostname: 'ROBVG', isProcessAlive: pid => alive.has(pid)
  });
  assert.equal(recovered.recoveredStaleLock, true, 'a dead worker lock is recovered');
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 202);

  assert.equal(first.release(), false, 'an old process cannot delete its replacement lock');
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 202);
  assert.equal(recovered.release(), true);
  assert.equal(fs.existsSync(lockPath), false);
  process.stdout.write('ARIA_WORKER_SINGLE_INSTANCE_LOCK=PASS\n');
  process.stdout.write('ARIA_WORKER_STALE_LOCK_RECOVERY=PASS\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
