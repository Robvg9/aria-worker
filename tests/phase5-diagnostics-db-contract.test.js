'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

async function run(){
const sql=fs.readFileSync('supabase/migrations/20260928230000_operational_diagnostics_v1.sql','utf8');
for(const col of ['trace_id','span_id','request_id','execution_id','error_code','runtime_version','source_sha']) assert.match(sql,new RegExp('add column if not exists '+col));
assert.match(sql,/create table if not exists aria_internal\.mission_diagnostics/);
for(const key of ['correlation','classification','diagnosis','versions','attempts','evidence_chain','health']) assert.match(sql,new RegExp(key));
assert.match(sql,/create trigger mission_events_diagnostic_enrichment/);
assert.match(sql,/jsonb_build_object\(/);
assert.match(sql,/v_payload \|\| jsonb_strip_nulls/,'canonical diagnostics must override conflicting payload correlation fields');
assert.match(sql,/aria_internal\.enrich_mission_event_diagnostics/);

const { analyzeMissionConsistency } = await import('../supabase/functions/_shared/mission-consistency.mjs');
const consistent = analyzeMissionConsistency({
  mission: { mission_id:'m-good', status:'succeeded', current_step:1, total_steps:1, completed_steps:1, updated_at:'2026-10-03T00:00:02Z' },
  steps: [{ step_index:1, status:'succeeded' }],
  jobs: [{ job_id:'j-good', status:'succeeded', completed_at:'2026-10-03T00:00:01Z' }],
  events: [{ event_type:'step_succeeded', created_at:'2026-10-03T00:00:02Z' }]
});
assert.equal(consistent.status,'consistent');
const drift = analyzeMissionConsistency({
  mission: { mission_id:'m-drift', status:'running', current_step:1, total_steps:2, completed_steps:0, updated_at:'2026-10-03T00:00:01Z' },
  steps: [{ step_index:1, status:'running' }],
  jobs: [{ job_id:'j-drift', status:'succeeded', completed_at:'2026-10-03T00:00:05Z' }],
  events: [{ event_type:'step_started', created_at:'2026-10-03T00:00:01Z' }],
  jobEvents: []
});
assert.equal(drift.status,'inconsistent');
assert.ok(drift.checks.some(check => check.code === 'terminal_job_without_mission_progress'));
const terminalWithJob = analyzeMissionConsistency({
  mission: { mission_id:'m-terminal', status:'succeeded', current_step:1, total_steps:1, completed_steps:1 },
  steps: [{ step_index:1, status:'succeeded' }],
  jobs: [{ job_id:'j-live', status:'running' }]
});
assert.equal(terminalWithJob.status,'inconsistent');
assert.ok(terminalWithJob.checks.some(check => check.code === 'terminal_mission_has_active_jobs'));
console.log('MISSION CONSISTENCY GUARD CONTRACT: PASS');
console.log('PHASE5 DIAGNOSTICS DB CONTRACT: PASS');
}
run().catch(error=>{console.error(error);process.exit(1);});
