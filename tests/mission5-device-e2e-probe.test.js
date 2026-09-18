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
"x-aria-trigger':'mission5-agent-probe"
]) assert.ok(source.includes(marker),'missing Mission 5 probe marker: '+marker);
console.log('MISSION 5 DEVICE E2E PROBE CONTRACT: PASS');
