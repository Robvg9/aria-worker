import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const supervisor = fs.readFileSync(path.join(root, 'agents', 'windows', 'desktop-commander-supervisor.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'agents', 'windows', 'install-desktop-commander-supervisor.ps1'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'agents', 'windows', 'DESKTOP_COMMANDER_AUTOSTART.md'), 'utf8');

test('DC supervisor uses the fixed Desktop Commander runtime', () => {
  assert.ok(supervisor.includes("$DcVersion = '0.2.52'"));
  assert.ok(supervisor.includes("Tools\\DesktopCommanderRemote"));
  assert.ok(supervisor.includes("desktop-commander\\dist\\index.js"));
  assert.ok(supervisor.includes("NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'"));
  assert.ok(!supervisor.includes("@wonderwhy-er/desktop-commander@latest"));
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

test('supervisor waits for remote MCP before starting DC', () => {
  assert.ok(supervisor.includes("Test-RemotePrerequisites"));
  assert.ok(supervisor.includes("waiting_for_network"));
  assert.ok(supervisor.includes("https://mcp.desktopcommander.app/api/mcp-info"));
});

test('installer registers an interactive logon task with automatic restart', () => {
  assert.match(installer, /ARIA-Desktop-Commander-Remote/);
  assert.match(installer, /<LogonTrigger>/);
  assert.match(installer, /<Delay>PT30S<\\/Delay>/);
  assert.match(installer, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(installer, /<RestartOnFailure>/);
  assert.match(installer, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
});

test('documentation defines the live close gate', () => {
  assert.match(docs, /device Online in Remote MCP/);
  assert.match(docs, /LIVE certification/);
});
