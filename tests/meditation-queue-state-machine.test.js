'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateway = fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-device-gateway','index.ts'),'utf8');
const migration = fs.readFileSync(path.join(__dirname,'..','supabase','migrations','20261001080000_canonical_meditation_queue_state_machine_v1.sql'),'utf8');

assert(gateway.includes('async function resumeManualContinuation'), 'continuation recovery function missing');
assert(gateway.includes(".in('status',['running','paused'])"), 'continuation scan must inspect running/paused queue items');
assert(gateway.includes("status:'running',resolved_mission_id:missionId"), 'non-terminal runtime must keep queue item running');
assert(gateway.includes("status==='running' || status==='waiting'"), 'runner running/waiting states must remain resumable');
assert(!gateway.includes('for(let i=0;i<7&&manual?.status===\'succeeded\';i++)'), 'queue tick must not fan out into eight missions');
assert(gateway.includes('Exactly one new queue item per service tick'), 'single-flight queue contract missing');

assert(migration.includes('create or replace function aria_internal.reconcile_meditation_queue_v2()'), 'queue reconciliation migration missing');
assert(migration.includes('timeout_milliseconds := 60000'), 'runner scheduler timeout must be explicit at 60s');
assert(migration.includes("'execution_lane'"), 'execution lane metadata missing');
assert(migration.includes("when 'primary' then 0"), 'primary objective must outrank backlog');
assert(migration.includes("when 'idea' then 90"), 'idea missions must be lower priority than primary objective');
assert(migration.includes("metadata->'decision'->>'action','')<>'accept'"), 'idea conversion must require explicit acceptance');

console.log('MEDITATION_QUEUE_STATE_MACHINE_CONTRACT=PASS');
