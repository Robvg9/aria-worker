'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('supabase/functions/aria-device-gateway/index.ts','utf8');
for(const marker of [
  "/v1/router/decide",
  "/v1/router/execute",
  "router_live_snapshot",
  "record_router_decision",
  "parallel_plan",
  "fallback_used",
  "required_tools_unavailable",
  "specialist_agent_required"
]) assert.ok(source.includes(marker),'missing Mission 6 gateway marker: '+marker);
console.log('MISSION 6 ROUTER V2 GATEWAY CONTRACT: PASS');