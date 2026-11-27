'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/aria-agent-runtime-v1/index.ts'), 'utf8');
const loopSource = fs.readFileSync(path.join(root, 'supabase/functions/aria-agent-runtime-v1/tool-loop.ts'), 'utf8');
const executionRuntime = fs.readFileSync(path.join(root, 'supabase/functions/aria-execution-runtime-v1/index.ts'), 'utf8');

for (const agent of [
  'aria-agent-planner-v1',
  'aria-agent-reviewer-v1',
  'aria-agent-research-v1',
  'aria-agent-coding-v1',
  'aria-agent-security-v1',
  'aria-agent-memory-v1',
  'aria-agent-business-v1',
  'aria-agent-device-v1',
  'aria-agent-android-coding-openrouter-v1',
]) assert.ok(source.includes(agent), 'missing agent profile: ' + agent);

assert.ok(source.includes('const MISSION_EXECUTION_PAUSED = true'), 'global mission freeze must remain active');
assert.ok(source.includes('const toolUse = b.policy?.tool_use === true || repairRequired;'));
assert.ok(source.includes('await toolLoop(agent, missionId, stepId, prompt, true, b.policy || {}, b.authorization || {})'));
assert.ok(source.includes('await toolLoop(agent, missionId, stepId, prompt, false, b.policy || {}, b.authorization || {})'));
assert.ok(!source.includes('mission_budget_tool_execution_not_integrated'));
assert.ok(source.includes('rawCode.startsWith("mission_budget_")'), 'wrapper must preserve terminal budget errors');
assert.ok(source.includes('agent_tool_loop_human_gate_required'), 'missing Human Gate fail-closed handling');

assert.ok(loopSource.includes('aria-execution-runtime-v1'));
assert.ok(loopSource.includes('async function callBudgetedModel('));
assert.ok(loopSource.includes('request_id: requestId'));
assert.ok(loopSource.includes('String(missionId) + ":" + String(stepId) + ":" + crypto.randomUUID()'));
assert.ok(loopSource.includes('missionBudgetTerminal'));
assert.ok(loopSource.includes('!missionBudgetTerminal && round === 0'), 'budget denial must stop provider fallback');
assert.ok(loopSource.includes('tool_choice: forceTool ? "required" : "auto"'));
assert.ok(loopSource.includes('geminiParts'), 'Gemini thought-signature parts must survive tool turns');
assert.ok(loopSource.includes('human_gate_required: true'), 'repair turns must require Human Gate');
assert.ok(loopSource.includes('preferredProvider === "openrouter"'));
assert.ok(loopSource.includes('providerLock'));
assert.ok(loopSource.includes('recovery_openrouter_free_route_unavailable'));
assert.ok(loopSource.includes('retryableProviderAvailability'));
assert.ok(loopSource.includes('github_file_patch'));
assert.ok(loopSource.includes('patch_match_count_'));
assert.ok(loopSource.includes('FINDINGS:') && loopSource.includes('VERDICT:'));
assert.doesNotMatch(loopSource, /generativelanguage\.googleapis\.com|openrouter\.ai\/api|GOOGLE_API_KEY|credential_read_secret/,
  'tool-loop must not call provider endpoints or read provider credentials directly');

assert.ok(executionRuntime.includes('reserveProviderCall(route,requestId,budgetContext'));
assert.ok(executionRuntime.includes('reserveMissionBudget(missionBudgetRpc,budgetContext)'));
assert.ok(executionRuntime.includes('body.toolConfig={functionCallingConfig:'));
assert.ok(executionRuntime.includes('tool_calls:toolCalls'), 'provider tool calls must be normalized for the loop');
assert.ok(executionRuntime.includes('reqBody.tool_choice=p.tool_choice==="required"?"required":"auto"'));
assert.ok(executionRuntime.includes('const MISSION_EXECUTION_PAUSED = true'));
console.log('AGENT RUNTIME V1 BUDGETED TOOL-LOOP CONTRACT: PASS');
