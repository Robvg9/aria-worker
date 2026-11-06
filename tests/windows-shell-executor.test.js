'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { parseShellJob, executePowerShell, validateScript, normalizeCwd } = require('../autonomy/windows-shell-executor');

test('accepts raw PowerShell command jobs', () => {
  const job = { device_id: 'windows-1', operation: 'shell.execute', command: 'Write-Output ARIA_WINDOWS_OK' };
  assert.deepEqual(parseShellJob(job, 'windows-1'), {
    script: 'Write-Output ARIA_WINDOWS_OK',
    cwd: process.env.USERPROFILE || process.cwd(),
    timeout_ms: 120_000,
    dry_run: false
  });
});

test('accepts structured PowerShell payloads', () => {
  const job = {
    device_id: 'windows-1',
    operation: 'shell.execute',
    command: JSON.stringify({ script: 'Get-Location', cwd: 'D:\\ARIA-Windows-Agent', timeout_ms: 10_000, dry_run: true })
  };
  assert.equal(parseShellJob(job, 'windows-1').cwd, 'D:\\ARIA-Windows-Agent');
  assert.equal(parseShellJob(job, 'windows-1').dry_run, true);
});

test('rejects destructive system commands', () => {
  assert.throws(() => validateScript('Remove-Partition -DiskNumber 0'), /shell_command_policy_blocked/);
  assert.throws(() => validateScript('shutdown /s /t 0'), /shell_command_policy_blocked/);
});

test('requires an absolute working directory', () => {
  assert.throws(() => normalizeCwd('relative-dir'), /shell_cwd_must_be_absolute/);
});

test('rejects jobs for another device or operation', () => {
  assert.throws(() => parseShellJob({ device_id: 'other', operation: 'shell.execute', command: 'Write-Output x' }, 'windows-1'), /unsupported_job/);
  assert.throws(() => parseShellJob({ device_id: 'windows-1', operation: 'ollama.qwen3', command: 'Write-Output x' }, 'windows-1'), /unsupported_job/);
});

test('authorization abort kills the active PowerShell process tree', { skip: process.platform !== 'win32' }, async (t) => {
  const pidFile = path.join(os.tmpdir(), `aria-shell-abort-${process.pid}-${Date.now()}.pid`);
  t.after(() => { try { fs.unlinkSync(pidFile); } catch {} });
  const controller = new AbortController();
  const escapedPidFile = pidFile.replace(/'/g, "''");
  const execution = executePowerShell({
    script: `[IO.File]::WriteAllText('${escapedPidFile}',[string]$PID); while ($true) { Start-Sleep -Seconds 1 }`,
    cwd: os.tmpdir(),
    timeout_ms: 30_000,
    signal: controller.signal,
  });

  for (let poll = 0; poll < 50 && !fs.existsSync(pidFile); poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const pid = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '';
  controller.abort();

  const result = await execution;
  assert.ok(pid, 'PowerShell process did not publish its PID before cancellation');
  assert.ok(Number.isInteger(Number(pid)) && Number(pid) > 0, 'PowerShell PID must be numeric');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.metadata?.cancelled, true);

  let processGone = false;
  for (let poll = 0; poll < 30; poll += 1) {
    try {
      const state = execFileSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`,
      ], { encoding: 'utf8', windowsHide: true }).trim();
      if (state === 'gone') { processGone = true; break; }
    } catch { processGone = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(processGone, true, `PowerShell PID ${pid} survived authorization cancellation`);
});
