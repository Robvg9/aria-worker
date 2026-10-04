'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261004004500_mission_execution_job_continuation_v1.sql'),
  'utf8'
);

assert.match(migration, /schedule_mission_runner_after_execution_job/);
assert.match(migration, /runner_tick_for_mission\(p_mission_id\)/);
assert.match(migration, /p_job_status NOT IN \('succeeded','failed','timeout'\)/);
assert.match(migration, /status IN \('succeeded','failed','blocked','cancelled'\)/);
assert.match(migration, /complete_execution_job_gateway/);
assert.match(migration, /IF p_status IN \('succeeded','failed','timeout'\) THEN/);
assert.match(migration, /PERFORM aria_internal\.schedule_mission_runner_after_execution_job/);
assert.match(migration, /Never roll back a successfully completed execution job/);
assert.match(migration, /mission\.continuation_tick_failed/);

console.log('MISSION EXECUTION JOB -> MISSION CONTINUATION CONTRACT: PASS');
