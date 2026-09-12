'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseShellJob, validateScript, normalizeCwd } = require('../autonomy/windows-shell-executor');

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
