import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const gateway=fs.readFileSync(path.join(root,"supabase/functions/aria-device-gateway/index.ts"),"utf8");
const migration=fs.readFileSync(path.join(root,"supabase/migrations/20260918152500_mission7_autonomy_cycles.sql"),"utf8");
const supervisor=fs.readFileSync(path.join(root,"supabase/functions/aria-autonomy-supervisor-v5/index.ts"),"utf8");

assert.match(gateway,/p===['"]\/v1\/autonomy\/cycle['"]/);
assert.match(gateway,/autonomyCycle/);
assert.match(gateway,/autonomy-post-plan-v1/);
assert.match(gateway,/autonomy_cycles/);
assert.match(gateway,/aria_autonomy_recover_stale_missions/);
assert.match(gateway,/generateCandidates/);
assert.match(gateway,/selectDynamicGoal/);
assert.match(gateway,/autonomy_only/);
assert.match(gateway,/aria-learning-v3/);
assert.match(gateway,/manual_confirmation/);
assert.match(gateway,/human_gate:/);
assert.match(gateway,/cycle_id/);
assert.match(gateway,/deduplicated/);
assert.match(supervisor,/aria-device-gateway/);
assert.match(supervisor,/\/v1\/autonomy\/cycle/);
assert.match(migration,/create table if not exists aria_internal\.autonomy_cycles/);
assert.match(migration,/cycle_id text primary key/);
assert.match(migration,/policy_version/);
assert.match(migration,/enable row level security/);
console.log("MISSION 7 AUTONOMY INTEGRATION CONTRACT: PASS");
