'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const loop = fs.readFileSync('supabase/functions/aria-agent-runtime-v1/tool-loop.ts', 'utf8');
const budgetClient = fs.readFileSync('supabase/functions/aria-agent-runtime-v1/budgeted-model-client-v1.mjs', 'utf8');
const agent = fs.readFileSync('supabase/functions/aria-agent-runtime-v1/index.ts', 'utf8');
const runtime = fs.readFileSync('supabase/functions/aria-execution-runtime-v1/index.ts', 'utf8');
const guard = fs.readFileSync('supabase/functions/aria-execution-runtime-v1/mission-budget-guard-v1.mjs', 'utf8');

assert.match(loop, /aria-execution-runtime-v1/);
assert.match(loop, /createBudgetedModelCaller/);
assert.match(loop, /classifyAgentToolModelFailure/);
assert.doesNotMatch(loop, /async function callBudgetedModel\(/);
assert.match(budgetClient, /mission_budget_required: true/);
assert.match(budgetClient, /request_id: requestId/);
assert.match(budgetClient, /agent_tool_loop_human_gate_required/);
assert.match(budgetClient, /request_id: requestId/);
assert.match(budgetClient, /missionBudgetTerminal/);
assert.match(budgetClient, /canFallback: !missionBudgetTerminal && round === 0/);
assert.match(budgetClient, /agent_tool_loop_human_gate_required/);
assert.match(budgetClient, /human_gate_required: true/);
assert.match(loop, /tool_call_id: toolCall.id, name/);
assert.doesNotMatch(loop, /generativelanguage\.googleapis\.com|openrouter\.ai\/api|GOOGLE_API_KEY|credential_read_secret/);

assert.match(agent, /const MISSION_EXECUTION_PAUSED = true/);
assert.match(agent, /toolLoop\(agent, missionId, stepId, prompt, true, b\.policy \|\| \{\}, b\.authorization \|\| \{\}\)/);
assert.match(agent, /rawCode\.startsWith\("mission_budget_"\)/);

for (const [name, url] of [
  ['directGemini', 'https://generativelanguage.googleapis.com/v1beta/models/'],
  ['openRouterChat', 'https://openrouter.ai/api/v1/chat/completions'],
]) {
  const start = runtime.indexOf('async function ' + name + '(');
  assert.notEqual(start, -1, 'missing provider adapter ' + name);
  const next = runtime.indexOf('\nasync function ', start + 20);
  const adapter = runtime.slice(start, next < 0 ? runtime.length : next);
  assert.ok(adapter.includes('reserveProviderCall(route,requestId,budgetContext'), name + ' must reserve before inference');
  assert.ok(adapter.indexOf('reserveProviderCall(route,requestId,budgetContext') < adapter.indexOf(url),
    name + ' must not dispatch before the budget/quota reservation');
}

assert.match(runtime, /body\.toolConfig=\{functionCallingConfig:/);
assert.match(runtime, /provider returned neither text nor a function call/);
assert.match(runtime, /reqBody\.tools=functions/);
assert.match(runtime, /reqBody\.tool_choice=/);
assert.match(runtime, /gemini_parts:parts/);
assert.match(runtime, /!Array\.isArray\(input\?\.payload\?\.tools\)/);
assert.match(runtime, /const MISSION_EXECUTION_PAUSED = true/);

assert.match(guard, /mission_budget_reserve_request_v1/);
assert.match(guard, /mission_budget_settle_request_v1/);
assert.match(guard, /mission_budget_settlement_pending/);

console.log('ARIA AGENT TOOL-LOOP MISSION BUDGET: PASS');
