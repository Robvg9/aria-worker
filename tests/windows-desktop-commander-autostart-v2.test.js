'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runAgent = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'run-agent.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'install-v2.ps1'), 'utf8');
const supervisor = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'desktop-commander-supervisor.ps1'), 'utf8');

test('ARIA watchdog owns Desktop Commander startup without a second scheduler', () => {
  assert.match(runAgent, /Ensure-DesktopCommanderSupervisor/);
  assert.match(runAgent, /desktop-commander-supervisor\.ps1/);
  assert.doesNotMatch(runAgent, /ARIA-Desktop-Commander-Remote/);
});

test('Desktop Commander runtime is pinned and installed on D:', () => {
  assert.match(installer, /DesktopCommanderRemote/);
  assert.match(installer, /@wonderwhy-er\/desktop-commander/);
  assert.match(installer, /0\.2\.52/);
  assert.match(installer, /NPM_CONFIG_CACHE/);
  assert.match(installer, /D:\\ARIA-Windows-Agent/);
});

test('Supervisor launches fixed runtime directly with network-family workaround', () => {
  assert.match(supervisor, /D:\\Databank\\node\.exe/);
  assert.match(supervisor, /desktop-commander\\dist\\index\.js/);
  assert.match(supervisor, /--dns-result-order=ipv4first/);
  assert.match(supervisor, /--no-network-family-autoselection/);
  assert.doesNotMatch(supervisor, /npx\.cmd/);
});

test('Supervisor retries instead of terminating ARIA when DC is unavailable', () => {
  assert.match(supervisor, /Start-Sleep -Seconds 30/);
  assert.match(supervisor, /SUPERVISOR_ERROR/);
  assert.match(supervisor, /CHILD_EXITED/);
});

test('Supervisor prevents duplicate instances with a named mutex', () => {
  assert.ok(supervisor.includes("Global\\ARIA-DesktopCommander-Supervisor-v2"));
  assert.ok(supervisor.includes("$created = $false"));
  assert.ok(supervisor.includes("if (-not $created) { exit 0 }"));
});
