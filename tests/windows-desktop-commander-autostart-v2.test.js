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
  assert.match(installer, /D:\\Databank\\node\.exe/);
  assert.match(installer, /D:\\Databank\\node\\node\.exe/);
  assert.match(installer, /Node\.js not found/);
});

test('Supervisor resolves Node from canonical config path with fixed D: fallbacks', () => {
  assert.match(supervisor, /config\.json/);
  assert.match(supervisor, /ConfiguredNodePath/);
  assert.match(supervisor, /D:\\Databank\\node\.exe/);
  assert.match(supervisor, /D:\\Databank\\node\\node\.exe/);
  assert.match(supervisor, /NodePath = \$NodeCandidates \| Where-Object \{ Test-Path \$_ \}/);
  assert.match(supervisor, /desktop-commander\\dist\\index\.js/);
  assert.match(supervisor, /--dns-result-order=ipv4first/);
  assert.match(supervisor, /--no-network-family-autoselection/);
  assert.match(supervisor, /MCP_SERVER_URL/);
  assert.doesNotMatch(supervisor, /npx\.cmd/);
});

test('Supervisor retries instead of terminating ARIA when DC is unavailable', () => {
  assert.match(supervisor, /Start-Sleep -Seconds 30/);
  assert.match(supervisor, /SUPERVISOR_ERROR/);
  assert.match(supervisor, /CHILD_EXITED/);
});

test('Supervisor does not overwrite PowerShell automatic PID variable', () => {
  assert.doesNotMatch(supervisor, /function Write-Status\([^\n]*\$Pid\b/i);
  assert.doesNotMatch(supervisor, /(^|\n)\s*\$pid\s*=/i);
  assert.match(supervisor, /\$desktopCommanderPid = Find-DesktopCommander/);
});

test('Supervisor prevents duplicate instances with a named mutex', () => {
  assert.ok(supervisor.includes("Global\\ARIA-DesktopCommander-Supervisor-v2"));
  assert.ok(supervisor.includes("$created = $false"));
  assert.ok(supervisor.includes("if (-not $created) { exit 0 }"));
});
test('Watchdog uses supervisor PID as a single-flight guard', () => {
  assert.match(runAgent, /DesktopCommanderSupervisorPidPath/);
  assert.match(runAgent, /Test-DesktopCommanderSupervisorPid/);
  assert.match(runAgent, /PID file is the primary single-flight guard/);
  assert.match(runAgent, /Remove-Item -Path \$DesktopCommanderSupervisorPidPath/);
  assert.match(runAgent, /IndexOf\('desktop-commander-supervisor\.ps1',\[System\.StringComparison\]::OrdinalIgnoreCase\)/);
  assert.doesNotMatch(runAgent, /desktop-commander-supervisor\\\\\.ps1/);
});

test('Installer preserves canonical device identity and does not reuse legacy id', () => {
  assert.match(installer, /ARIA_DEVICE_ID/);
  assert.match(installer, /ExistingDeviceId/);
  assert.match(installer, /refusing to invent or reuse a legacy device id/);
  assert.doesNotMatch(installer, /windows-fe722cc6681e4f9c9cc35f5ebbb0a089/);
});

test('Logon bootstrap waits briefly for Windows networking', () => {
  assert.match(installer, /<Delay>PT30S<\/Delay>/);
});

test('Supervisor distinguishes process liveness from remote channel health', () => {
  assert.match(supervisor, /function Get-RemoteChannelState/);
  assert.match(supervisor, /Channel subscribed/);
  assert.match(supervisor, /IncreaseConnectionPool/);
  assert.match(supervisor, /channel_last_subscribed/);
  assert.match(supervisor, /channel_degraded/);
  assert.match(supervisor, /channel_unverified/);
  assert.match(supervisor, /process_alive = \(\$ProcessId -gt 0\)/);
  assert.match(supervisor, /channel_state = if/);
  assert.doesNotMatch(supervisor, /Write-Status 'running'/);
  assert.match(supervisor, /Write-ObservedChannelStatus \$desktopCommanderPid/);
});


test('Supervisor recovers a persistently degraded remote channel with bounded restarts', () => {
  assert.match(supervisor, /Recreating channel/);
  assert.match(supervisor, /Failed to set session/);
  assert.match(supervisor, /function Invoke-ChannelRecovery/);
  assert.match(supervisor, /ChannelRestartThresholdSeconds = 180/);
  assert.match(supervisor, /ChannelRestartMaxPerHour = 2/);
  assert.match(supervisor, /persistent_channel_degraded/);
  assert.match(supervisor, /CHANNEL_RESTART_LIMIT_REACHED/);
  assert.match(supervisor, /Stop-Process -Id \\$ProcessId -Force -ErrorAction Stop/);
  assert.match(supervisor, /Invoke-ChannelRecovery -ProcessId \\$desktopCommanderPid -State \\$channel.State/);
});
