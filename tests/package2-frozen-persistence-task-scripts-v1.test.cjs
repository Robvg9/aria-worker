'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const installer = fs.readFileSync(path.join(root, 'scripts/Install-ARIA-Package2-Frozen-Persistence-Task.ps1'), 'utf8');
const wrapper = fs.readFileSync(path.join(root, 'scripts/Run-ARIA-Package2-Frozen-Persistence-Task.ps1'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'tests/fixtures/aria-frozen-worker-probe-adapter.js'), 'utf8');

function has(source, pattern, message) {
  assert.match(source, pattern, message);
}

function ordered(source, first, second, message) {
  const a = source.indexOf(first);
  const b = source.indexOf(second);
  assert.ok(a >= 0 && b > a, message);
}

has(installer, /COMPUTERNAME -ne 'ROBVG'/, 'installer must refuse hosts other than ROBVG');
has(installer, /Environment\]::UserInteractive/, 'installer must require an interactive Windows session');
has(installer, /SessionId\s*-eq\s*0/, 'installer must reject session 0');
has(installer, /S-1-5-18.*S-1-5-20|S-1-5-18', 'S-1-5-20'/s, 'installer must reject SYSTEM and NETWORK SERVICE identities');
has(installer, /Read-Host .* -AsSecureString/, 'worker token must be requested as hidden secure input');
has(installer, /ConvertFrom-SecureString -SecureString \$secureToken/, 'installer must use DPAPI current-user protection');
has(installer, /protectedForSid\s*=\s*\$identity\.User\.Value/, 'DPAPI config must be bound to current user SID');
has(installer, /MISSION_EXECUTION_PAUSED\\s\*=\\s\*true/, 'installer must check the coordinator hard freeze');
has(installer, /ROBVG_PREINSTALL_CLAIM_423=PASS/, 'installer must preflight claim HTTP 423 before creating config or task');
has(installer, /New-ScheduledTaskTrigger -AtLogOn -User \$identity\.Name/, 'scheduled task must use current interactive user AtLogOn');
has(installer, /New-ScheduledTaskPrincipal -UserId \$identity\.Name -LogonType Interactive -RunLevel Limited/, 'scheduled task must use current-user interactive limited principal');
has(installer, /Disable-ScheduledTask -TaskName \$TaskName/, 'task must be registered Disabled first');
ordered(installer, 'Disable-ScheduledTask -TaskName $TaskName', 'if ($EnableAndReboot)', 'task must be verified disabled before optional reboot enablement');
has(installer, /if \(\$EnableAndReboot\)[\s\S]*?Enable-ScheduledTask/, 'only explicit EnableAndReboot switch may enable the task');
has(installer, /shutdown\.exe[\s\S]*?\/r \/t 30/, 'approved path schedules a bounded reboot after enabling the one-shot task');
has(installer, /aria-frozen-worker-probe-adapter\.js/, 'installer must select the no-op frozen probe adapter');
has(adapter, /FROZEN_WORKER_PROBE_MUST_NEVER_EXECUTE_TASKS/, 'probe adapter must refuse task execution');
has(installer, /S-1-5-18/, 'evidence ACL must preserve SYSTEM access');
has(installer, /S-1-5-32-544/, 'evidence ACL must preserve Administrators access');
has(installer, /S-1-5-20/, 'runner service must receive read-only evidence access');
assert.doesNotMatch(installer, /ARIA_WORKER_TOKEN=.*Write-Output|Write-Output.*ARIA_WORKER_TOKEN=/s, 'installer must never print token values');

has(wrapper, /protectedForSid.*identity\.User\.Value/, 'wrapper must verify DPAPI identity matches task identity');
has(wrapper, /MISSION_EXECUTION_PAUSED\\s\*=\\s\*true/, 'wrapper must verify coordinator freeze before worker start');
has(wrapper, /Disable-ScheduledTask -TaskName \$TaskName/, 'wrapper must disable its one-shot task after execution');
has(wrapper, /workerStoppedByFreeze/, 'wrapper must record freeze stop');
has(wrapper, /supervisorCleanStop/, 'wrapper must record supervisor clean stop');
has(wrapper, /startCount -eq 1/, 'wrapper must require exactly one worker start');
has(wrapper, /S-1-5-18/, 'evidence ACL must preserve SYSTEM access');
has(wrapper, /S-1-5-32-544/, 'evidence ACL must preserve Administrators access');
has(wrapper, /S-1-5-20/, 'runner service must receive read-only evidence access');
assert.doesNotMatch(wrapper, /Enable-ScheduledTask|Register-ScheduledTask|shutdown\.exe|ARIA_AUTONOMY_WORKER_TOKEN\s*=\s*['"][^$]/, 'one-shot wrapper must not enable/register/reboot or embed credentials');

console.log('PACKAGE2_FROZEN_PERSISTENCE_INSTALLER_CONTRACT=PASS');
console.log('PACKAGE2_INTERACTIVE_DPAPI_IDENTITY_CONTRACT=PASS');
console.log('PACKAGE2_TASK_DISABLED_UNTIL_EXPLICIT_REBOOT=PASS');
console.log('PACKAGE2_ONE_SHOT_WORKER_SELF_DISABLE_CONTRACT=PASS');
console.log('PACKAGE2_EVIDENCE_ACL_CONTRACT=PASS');
