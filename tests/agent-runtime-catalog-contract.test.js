'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const path = require.resolve('../supabase/functions/aria-agent-runtime-v1/index.ts');
const source = fs.readFileSync(path, 'utf8');

const expectedAgents = [
  'aria-agent-planner-v1',
  'aria-agent-reviewer-v1',
  'aria-agent-research-v1',
  'aria-agent-coding-v1',
  'aria-agent-security-v1',
  'aria-agent-memory-v1',
  'aria-agent-business-v1',
  'aria-agent-device-v1'
];

for (const agentId of expectedAgents) {
  assert.ok(source.includes(`"${agentId}"`), `missing LIVE profile: ${agentId}`);
}
assert.ok(source.includes('sb.rpc("aria_agent_catalog")'));
assert.ok(source.includes('status === "available"'));
assert.ok(source.includes('catalogAgent.model_id'));
assert.ok(source.includes('catalog_source: "aria_agent_catalog"'));
assert.ok(source.includes('agent_risk_exceeded'));
assert.ok(source.includes('agent_scope_denied'));
assert.ok(source.includes('RISK_RANK'));
assert.ok(source.includes('MAX_RISK_RANK'));
assert.ok(!source.includes('const agents:Record<string,{model_id:string;system:string}>'));

console.log('agent-runtime-catalog-contract.test.js: ok');
