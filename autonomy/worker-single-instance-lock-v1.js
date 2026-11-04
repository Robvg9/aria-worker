'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function processIsAlive(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function acquireWorkerInstanceLock({
  lockPath,
  pid = process.pid,
  hostname = os.hostname(),
  isProcessAlive = processIsAlive,
  now = Date.now
} = {}) {
  if (typeof lockPath !== 'string' || !lockPath.trim()) throw new TypeError('worker_lock_path_required');
  const target = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let recoveredStaleLock = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = {
      version: 1,
      pid: Number(pid),
      hostname: String(hostname),
      token: crypto.randomBytes(24).toString('hex'),
      created_at: new Date(now()).toISOString()
    };
    let descriptor;
    try {
      descriptor = fs.openSync(target, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(record), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      let released = false;
      return Object.freeze({
        lockPath: target,
        recoveredStaleLock,
        release() {
          if (released) return false;
          released = true;
          try {
            const current = JSON.parse(fs.readFileSync(target, 'utf8'));
            if (current.token !== record.token) return false;
            fs.unlinkSync(target);
            return true;
          } catch (error) {
            if (error && error.code === 'ENOENT') return false;
            throw error;
          }
        }
      });
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) {}
        try { fs.unlinkSync(target); } catch (_) {}
      }
      if (!error || error.code !== 'EEXIST') throw error;

      let current;
      let stat;
      try {
        stat = fs.statSync(target);
        current = JSON.parse(fs.readFileSync(target, 'utf8'));
      } catch (readError) {
        if (readError && readError.code === 'ENOENT') continue;
        if (now() - (stat && stat.mtimeMs || 0) < 10000) {
          const busy = new Error('ARIA_WORKER_INSTANCE_LOCK_INITIALIZING');
          busy.code = 'ARIA_WORKER_ALREADY_RUNNING';
          busy.exitCode = 75;
          throw busy;
        }
        try { fs.unlinkSync(target); recoveredStaleLock = true; continue; }
        catch (unlinkError) { if (unlinkError && unlinkError.code === 'ENOENT') continue; throw unlinkError; }
      }

      const sameHost = current.hostname === String(hostname);
      const ownerAlive = sameHost && isProcessAlive(Number(current.pid));
      if (ownerAlive) {
        const busy = new Error('ARIA_WORKER_ALREADY_RUNNING');
        busy.code = 'ARIA_WORKER_ALREADY_RUNNING';
        busy.exitCode = 75;
        throw busy;
      }

      try {
        const latest = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (latest.token !== current.token) continue;
        fs.unlinkSync(target);
        recoveredStaleLock = true;
      } catch (unlinkError) {
        if (unlinkError && unlinkError.code === 'ENOENT') continue;
        throw unlinkError;
      }
    }
  }

  const busy = new Error('ARIA_WORKER_INSTANCE_LOCK_BUSY');
  busy.code = 'ARIA_WORKER_ALREADY_RUNNING';
  busy.exitCode = 75;
  throw busy;
}

module.exports = Object.freeze({ acquireWorkerInstanceLock });
