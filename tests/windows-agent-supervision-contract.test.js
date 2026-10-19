import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = fs.readFileSync(path.join(root, 'agents/windows/install-v2.ps1'), 'utf8');
const watchdog = fs.readFileSync(path.join(root, 'agents/windows/run-agent.ps1'), 'utf8');

// One durable startup authority: Windows Task Scheduler under the interactive
// user, with OS-level restart semantics. The user Run key is intentionally not
// an authority because it only runs at user logon and cannot recover a dead
// watchdog during an active session.
assert.match(installer, /Register-ScheduledTask/);
assert.match(installer, /New-ScheduledTaskPrincipal/);
assert.match(installer, /-LogonType Interactive/);
assert.match(installer, /-RestartCount 999/);
assert.match(installer, /-RestartInterval \(New-TimeSpan -Minutes 1\)/);
assert.match(installer, /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
assert.match(installer, /-MultipleInstances IgnoreNew/);
assert.match(installer, /startup_authority = 'task_scheduler_restart_on_failure'/);
assert.match(installer, /Remove-ItemProperty/);
assert.doesNotMatch(installer, /startup_authority = 'user_run_singleton'/);
assert.doesNotMatch(installer, /task_scheduler = 'not_used_by_aria'/);

// The watchdog itself must never give up after transient failures. Its outer
// loop is the second line of defense and must remain infinite. Child failures
// are restarted; supervisor failures are absorbed and retried.
assert.match(watchdog, /while \(\$true\)/);
assert.match(watchdog, /supervision_policy = 'non_terminating'/);
assert.doesNotMatch(watchdog, /\$maxConsecutiveErrors/);
assert.doesNotMatch(watchdog, /WATCHDOG_EXIT after/);
assert.doesNotMatch(watchdog, /exit 1/);

console.log('WINDOWS_AGENT_SUPERVISION_CONTRACT_V1_OK');
