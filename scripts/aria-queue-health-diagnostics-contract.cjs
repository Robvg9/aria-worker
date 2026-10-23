'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const report = fs.readFileSync(
  path.join(__dirname, '..', 'reports', 'sql', 'aria-queue-health-readonly.sql'),
  'utf8'
);
const executableSql = report
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

for (const token of [
  'aria_internal.mission_state',
  'aria_internal.execution_jobs',
  'aria_internal.device_registry',
  'goal_source',
  'execution_lane',
  'lease_until',
  'completed_at',
  'active_job_rows',
  'heartbeat_age'
]) {
  assert.ok(report.includes(token), 'diagnostic query must include ' + token);
}

assert.equal((report.match(/^SELECT\b/gmi) || []).length, 5,
  'the report must keep its five standalone SELECT statements');
assert.match(report, /^WITH jobs_by_mission AS \(/mi,
  'job reconciliation must use a read-only CTE');

assert.doesNotMatch(
  executableSql,
  /^\s*(?:INSERT\b\s+INTO\b|UPDATE\b\s+\S+\s+SET\b|DELETE\b\s+FROM\b|MERGE\b\s+INTO\b|TRUNCATE\b|ALTER\b|DROP\b|CREATE\b|GRANT\b|REVOKE\b|CALL\b|DO\b\s+\$)/im,
  'queue diagnostics must not mutate production state'
);
assert.doesNotMatch(executableSql, /cron\.schedule|cron\.unschedule|pg_notify/i,
  'queue diagnostics must not schedule work or dispatch side effects');

console.log('ARIA queue-health read-only diagnostic contract: PASS');
