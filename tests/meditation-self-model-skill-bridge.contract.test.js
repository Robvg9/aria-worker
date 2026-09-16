'use strict';

const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260913_meditation_verified_self_model_skill_bridge.sql'),
  'utf8'
);

const required = [
  "coalesce(new.metadata->>'source','') <> 'meditation-ia-v1'",
  "coalesce(v_goal_source,'') <> 'meditation-ia-v1'",
  "coalesce(v_goal_metadata->>'meditation_origin','false') <> 'true'",
  'aria_memory.upsert_world_entity',
  'aria_memory.compile_skill_for_goal',
  "'meditation_verified_mission'",
  "'skill_promoted'",
  "'meditation_cycle_postprocessed'",
  "'promotion_evidence_required', 3",
];

for (const needle of required) {
  if (!migration.includes(needle)) throw new Error(`bridge_contract_missing:${needle}`);
}

if (!migration.includes('AFTER UPDATE OF status ON aria_internal.mission_state')) {
  throw new Error('bridge_trigger_missing');
}

if (!migration.includes("new.status <> 'succeeded' or old.status = 'succeeded'")) {
  throw new Error('bridge_transition_guard_missing');
}

console.log('MEDITATION_SELF_MODEL_SKILL_BRIDGE_CONTRACT=PASS');
