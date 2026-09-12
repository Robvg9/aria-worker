'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 3_600_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

const WINDOWS_SHELL_BLOCKLIST = [
  /\b(format-volume|remove-partition|clear-disk)\b/i,
  /\b(shutdown|restart-computer|stop-computer)\b/i,
  /\b(reg\s+delete|bcdedit)\b/i,
  /\b(diskpart)\b/i,
  /\b(del|erase|rd|rmdir)\s+.*(?:\\windows\\|\\program\s+files|system32)/i,
  /\b(netsh\s+firewall|netsh\s+advfirewall)\b/i
];

function normalizeCwd(value) {
  if (value === undefined || value === null || value === '') return process.env.USERPROFILE || process.cwd();
  if (typeof value !== 'string') throw new Error('shell_cwd_invalid');
  const cwd = path.win32.normalize(value);
  if (!path.win32.isAbsolute(cwd)) throw new Error('shell_cwd_must_be_absolute');
  return cwd;
}

function validateScript(script) {
  if (typeof script !== 'string' || !script.trim()) throw new Error('shell_command_required');
  if (script.length > 64 * 1024) throw new Error('shell_command_too_large');
  for (const pattern of WINDOWS_SHELL_BLOCKLIST) {
    if (pattern.test(script)) throw new Error('shell_command_policy_blocked');
  }
  return script;
}

function parseShellJob(job, deviceId) {
  if (!job || job.device_id !== deviceId || job.operation !== 'shell.execute') throw new Error('unsupported_job');
  if (typeof job.command !== 'string' || !job.command.trim()) throw new Error('shell_payload_required');

  let payload;
  try { payload = JSON.parse(job.command); } catch (_) { payload = null; }

  if (!payload) payload = { script: job.command };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('shell_payload_invalid');

  const keys = Object.keys(payload);
  if (keys.some((key) => !['script', 'cwd', 'timeout_ms', 'dry_run'].includes(key))) {
    throw new Error('shell_payload_field_rejected');
  }

  const script = validateScript(payload.script);
  const cwd = normalizeCwd(payload.cwd);
  const timeoutMs = payload.timeout_ms ?? job.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) throw new Error('shell_timeout_rejected');
  if (payload.dry_run !== undefined && typeof payload.dry_run !== 'boolean') throw new Error('shell_dry_run_invalid');

  return Object.freeze({ script, cwd, timeout_ms: timeoutMs, dry_run: payload.dry_run === true });
}

function executePowerShell({ script, cwd, timeout_ms: timeoutMs, dry_run: dryRun }) {
  if (dryRun) {
    return Promise.resolve({
      status: 'planned',
      exit_code: 0,
      stdout: '',
      stderr: '',
      duration_ms: 0,
      metadata: { shell: 'powershell.exe', cwd, dry_run: true }
    });
  }

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, duration_ms: Date.now() - started });
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({
        status: 'timeout',
        exit_code: null,
        stdout: stdout.slice(-MAX_OUTPUT_BYTES),
        stderr: `${stderr}\nPowerShell execution timed out after ${timeoutMs} ms`.trim().slice(-MAX_OUTPUT_BYTES),
        metadata: { shell: 'powershell.exe', cwd, timeout_ms: timeoutMs }
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stdout.length);
    });

    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - stderr.length);
    });

    child.on('error', (error) => {
      finish({
        status: 'failed',
        exit_code: null,
        stdout,
        stderr: String(error?.message || error).slice(0, MAX_OUTPUT_BYTES),
        metadata: { shell: 'powershell.exe', cwd, timeout_ms: timeoutMs }
      });
    });

    child.on('close', (code) => {
      finish({
        status: code === 0 ? 'succeeded' : 'failed',
        exit_code: code,
        stdout,
        stderr,
        metadata: {
          shell: 'powershell.exe',
          cwd,
          timeout_ms: timeoutMs,
          stdout_truncated: stdoutBytes > MAX_OUTPUT_BYTES,
          stderr_truncated: stderrBytes > MAX_OUTPUT_BYTES
        }
      });
    });
  });
}

module.exports = Object.freeze({ parseShellJob, executePowerShell, validateScript, normalizeCwd });
