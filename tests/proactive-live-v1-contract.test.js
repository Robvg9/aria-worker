'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync(
  require.resolve('../supabase/functions/aria-proactive-live-v1/index.ts'),
  'utf8'
);
const engine = fs.readFileSync(
  require.resolve('../supabase/functions/aria-proactive-live-v1/proactive-engine.mjs'),
  'utf8'
);
const migration = fs.readFileSync(
  require.resolve('../supabase/migrations/20261004030000_proactive_digests_v1.sql'),
  'utf8'
);

assert.match(index, /get_operational_health_v1/);
assert.match(index, /router_live_snapshot/);
assert.match(index, /proactive_digests/);
assert.match(index, /recommendation_only/);
assert.match(index, /persisted:s*true/);
assert.doesNotMatch(index, /aria_mission_create|enqueue_execution_job|claim_execution_job|runner_tick_for_mission|meditation_queue_add/);
assert.doesNotMatch(engine, /enqueue_execution_job|claim_execution_job|runner_tick_for_mission|meditation_queue_add|execute/i);
assert.match(migration, /create table if not exists aria_internal.proactive_digests/);
assert.match(migration, /enable row level security/);
assert.match(migration, /grant select, insert on aria_internal.proactive_digests to service_role/);

console.log('PROACTIVE LIVE V1 CONTRACT: PASS — read-only sources, deterministic digest path, persisted provenance, no mission actuation');
