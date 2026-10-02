import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const supervisor = fs.readFileSync(path.join(root, 'agents', 'windows', 'desktop-commander-supervisor.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'agents', 'windows', 'install-desktop-commander-supervisor.ps1'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'agents', 'windows', 'DESKTOP_COMMANDER_AUTOSTART.md'), 'utf8');

test('DC supervisor uses pinned remote package version', () => {
  assert.match(supervisor, /@wonderwhy-er\/desktop-commander@0\.2\.52/);
  assert.doesNotMatch(supervisor, /@wonderwhy-er\/desktop-commander@latest/);
});

test('DC supervisor preserves authentication as a human gate', () => {
  assert.match(supervisor, /HUMAN_GATE_AUTH_REQUIRED/);
  assert.match(supervisor, /interactive authorization\/pairing/);
});

test('DC supervisor avoids duplicate instances', () => {
  assert.match(supervisor, /Find-ExistingDesktopCommander/);
  assert.match(supervisor, /ADOPT_EXISTING/);
  assert.match(supervisor, /Global\\ARIA-DesktopCommander-Remote-Supervisor-v1/);
});

test('installer registers an interactive logon task with automatic restart', () => {
  assert.match(installer, /ARIA-Desktop-Commander-Remote/);
  assert.match(installer, /<LogonTrigger>/);
  assert.match(installer, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(installer, /<RestartOnFailure>/);
  assert.match(installer, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
});

test('documentation defines the live close gate', () => {
  assert.match(docs, /device Online in Remote MCP/);
  assert.match(docs, /LIVE certification/);
});
