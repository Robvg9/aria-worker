'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','supabase/functions/aria-device-gateway/index.ts'),'utf8');
for(const marker of [
"/v1/mission5/agent-probe",
"mission5AgentProbe",
"agent_not_allowed_for_mission5_probe",
"mission5_probe_read_only",
"resource_graph:'aria_internal.resolve_agent_resource'",
"aria-agent-planner-gemini35-v1",
"aria-agent-verifier-gemini35-v1",
"M5_VERIFIER_E2E_OK",
"x-aria-trigger':'mission5-agent-probe"
]) assert.ok(source.includes(marker),'missing Mission 5 probe marker: '+marker);
assert.ok(source.includes("v1/mission5/model-probe"),'missing Mission 5 model probe marker: '+"v1/mission5/model-probe");
assert.ok(source.includes("mission5ModelProbe"),'missing Mission 5 model probe marker: '+"mission5ModelProbe");
assert.ok(source.includes("model_not_allowed_for_mission5_probe"),'missing Mission 5 model probe marker: '+"model_not_allowed_for_mission5_probe");
assert.ok(source.includes("mission5_model_probe_read_only"),'missing Mission 5 model probe marker: '+"mission5_model_probe_read_only");
assert.ok(source.includes("google/gemini-2.5-flash-lite"),'missing Mission 5 model probe marker: '+"google/gemini-2.5-flash-lite");
assert.ok(source.includes("acct_openrouter_primary"),'missing Mission 5 model probe marker: '+"acct_openrouter_primary");
assert.ok(source.includes("mission5:model-probe"),'missing Mission 5 model probe marker: '+"mission5:model-probe");
console.log('MISSION 5 DEVICE E2E PROBE CONTRACT: PASS');
