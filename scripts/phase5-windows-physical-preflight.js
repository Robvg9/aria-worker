'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

const requiredFiles = [
  'agents/windows/aria-agent.js',
  'agents/windows/autonomous-rwht-controller.js',
  'agents/windows/install-v2.ps1',
  'computer-use/windows-desktop-adapter.js',
  'computer-use/windows-desktop-runner.ps1',
  'tests/windows-desktop-physical-e2e.js',
  'tests/windows-computer-use.test.js',
  'tests/computer-use-runtime-v1.test.js',
  'tests/autonomous-windows-rwht-controller.test.js'
];

const findings = [];
for (const rel of requiredFiles) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    findings.push({ check: rel, status: 'FAIL', detail: 'required_file_missing' });
  } else {
    findings.push({ check: rel, status: 'PASS', detail: 'present' });
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const agent = read('agents/windows/aria-agent.js');
const adapter = read('computer-use/windows-desktop-adapter.js');
const physical = read('tests/windows-desktop-physical-e2e.js');

const contracts = [
  ['windows_agent_version', /aria-windows-agent-v2/],
  ['autonomous_computer_use', /computer\.use\.autonomous/],
  ['shell_execute', /shell\.execute/],
  ['computer_use', /computer\.use/],
  ['desktop_adapter_version', /aria-windows-desktop-v1\.9/],
  ['powershell_sta', /-STA/],
  ['physical_e2e_observe', /observe-chrome/],
  ['physical_e2e_recovery', /controlled-timeout/],
  ['physical_e2e_screenshot', /screenshot-chrome/]
];

for (const [check, pattern] of contracts) {
  const haystack = check.startsWith('physical_e2e_') ? physical : check === 'desktop_adapter_version' || check === 'powershell_sta' ? adapter : agent;
  findings.push({
    check,
    status: pattern.test(haystack) ? 'PASS' : 'FAIL',
    detail: pattern.test(haystack) ? 'contract_present' : 'contract_missing'
  });
}

const platform = process.platform;
if (platform === 'win32') {
  let powershell = null;
  try {
    powershell = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' }).trim();
  } catch (error) {
    findings.push({ check: 'powershell', status: 'FAIL', detail: String(error.message || error) });
  }
  if (powershell) findings.push({ check: 'powershell', status: 'PASS', detail: powershell });
} else {
  findings.push({ check: 'physical_runtime', status: 'DEFERRED', detail: 'run_on_windows_host_for_physical_certification' });
}

const ok = findings.every((item) => item.status === 'PASS' || item.status === 'DEFERRED');
const report = {
  phase: '5/9',
  name: 'Windows Physical',
  branch: 'aria/phase5-windows-physical-20260930',
  generated_at: new Date().toISOString(),
  platform,
  status: ok ? 'PREFLIGHT_PASS' : 'PREFLIGHT_FAIL',
  findings
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = ok ? 0 : 1;
