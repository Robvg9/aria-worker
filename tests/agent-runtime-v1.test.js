'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/aria-agent-runtime-v1/index.ts'), 'utf8');
const loopSource = fs.readFileSync(path.join(root, 'supabase/functions/aria-agent-runtime-v1/tool-loop.ts'), 'utf8');
const budgetClient = fs.readFileSync(path.join(root, 'supabase/functions/aria-agent-runtime-v1/budgeted-model-client-v1.mjs'), 'utf8');
const executionRuntime = fs.readFileSync(path.join(root, 'supabase/functions/aria-execution-runtime-v1/index.ts'), 'utf8');
const internalOutcomeHelper = fs.readFileSync(path.join(root, 'supabase/functions/aria-agent-runtime-v1/internal-execution-outcome-v1.mjs'), 'utf8');

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
assert.ok(source.includes('const terminalBudgetBlock = errorCode.startsWith("mission_budget_")'), 'normal delegation must classify budget denial as terminal');
assert.ok(source.includes('const failureStatus = terminalBudgetBlock ? "blocked" : "failed"'), 'normal delegation must surface budget denial as blocked');
assert.ok(source.includes('terminalBudgetBlock ? 423 : 200'), 'normal delegation must return a blocking HTTP status for budget denial');
assert.ok(source.includes('fetchAgentExecutionOutcome(fetch, EXEC'), 'normal delegation must use the internal execution response-loss guard');
assert.ok(!source.includes('const rr = await fetch(EXEC'), 'normal delegation must not bypass the response-loss guard');
assert.ok(internalOutcomeHelper.includes('mission_budget_execution_runtime_outcome_unknown'), 'lost internal execution responses must become terminal budget blocks');
assert.ok(internalOutcomeHelper.includes('status >= 500'), 'unstructured internal 5xx must be outcome-unknown');

assert.ok(source.includes('agent_tool_loop_human_gate_required'), 'missing Human Gate fail-closed handling');

assert.ok(loopSource.includes('aria-execution-runtime-v1'));
assert.ok(loopSource.includes('createBudgetedModelCaller'));
assert.ok(loopSource.includes('classifyAgentToolModelFailure'));
assert.ok(budgetClient.includes('request_id: requestId'));
assert.ok(budgetClient.includes("mission + ':' + step + ':' + nonce"), 'request ID must bind mission, step and unique nonce');
assert.ok(budgetClient.includes('missionBudgetTerminal'));
assert.ok(budgetClient.includes('canFallback: !missionBudgetTerminal && round === 0'), 'budget denial must stop provider fallback');
assert.ok(budgetClient.includes("tool_choice: forceTool ? 'required' : 'auto'"));
assert.ok(budgetClient.includes('geminiParts'), 'Gemini thought-signature parts must survive tool turns');
assert.ok(budgetClient.includes('human_gate_required: true'), 'repair turns must require Human Gate');
assert.ok(budgetClient.includes('retryableProviderAvailability'));
assert.ok(loopSource.includes('preferredProvider === "openrouter"'));
assert.ok(loopSource.includes('providerLock'));
assert.ok(loopSource.includes('recovery_openrouter_free_route_unavailable'));
assert.ok(loopSource.includes('fallbackDecision.retryableProviderAvailability'));
assert.ok(loopSource.includes('github_file_patch'));
assert.ok(loopSource.includes('patch_match_count_'));
assert.ok(loopSource.includes('FINDINGS:') && loopSource.includes('VERDICT:'));
assert.doesNotMatch(loopSource, /generativelanguage\.googleapis\.com|openrouter\.ai\/api|GOOGLE_API_KEY|credential_read_secret/,
  'tool-loop must not call provider endpoints or read provider credentials directly');

assert.ok(executionRuntime.includes('reserveProviderCall(route,requestId,budgetContext'));
assert.ok(executionRuntime.includes('reserveMissionBudget(missionBudgetRpc,budgetContext,{'), 'mission budget reservation must include any available preflight estimate');
assert.ok(executionRuntime.includes('estimateMissionTokenUpperBound(route,providerPayload)'), 'mission token bound must be evaluated before reserve');
assert.ok(executionRuntime.includes('body.toolConfig={functionCallingConfig:'));
assert.ok(executionRuntime.includes('tool_calls:toolCalls'), 'provider tool calls must be normalized for the loop');
assert.ok(executionRuntime.includes('reqBody.tool_choice=p.tool_choice==="required"?"required":"auto"'));
assert.ok(executionRuntime.includes('const MISSION_EXECUTION_PAUSED = true'));
console.log('AGENT RUNTIME V1 BUDGETED TOOL-LOOP CONTRACT: PASS');


(async () => {
  const { fetchAgentExecutionOutcome } = await import('../supabase/functions/aria-agent-runtime-v1/internal-execution-outcome-v1.mjs');
  const endpoint = 'https://mock.invalid/functions/v1/aria-execution-runtime-v1';
  const init = { method: 'POST', body: '{"request_id":"mission:step:nonce"}' };
  const lostFetch = await fetchAgentExecutionOutcome(async () => { throw new Error('connection reset after dispatch'); }, endpoint, init);
  assert.equal(lostFetch.kind, 'unknown');
  assert.equal(lostFetch.error.code, 'mission_budget_execution_runtime_outcome_unknown');
  const lostBody = await fetchAgentExecutionOutcome(async () => ({ ok: true, status: 200, json: async () => { throw new Error('stream truncated'); } }), endpoint, init);
  assert.equal(lostBody.kind, 'unknown');
  assert.equal(lostBody.status, 200);
  const emptyBody = await fetchAgentExecutionOutcome(async () => ({ ok: true, status: 200, json: async () => null }), endpoint, init);
  assert.equal(emptyBody.kind, 'unknown');
  const successWithoutStatus = await fetchAgentExecutionOutcome(async () => ({ ok: true, status: 200, json: async () => ({ response: { content: 'possibly dispatched' } }) }), endpoint, init);
  assert.equal(successWithoutStatus.kind, 'unknown');
  const ambiguousServerFailure = await fetchAgentExecutionOutcome(async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream gateway error' }) }), endpoint, init);
  assert.equal(ambiguousServerFailure.kind, 'unknown');
  assert.equal(ambiguousServerFailure.status, 502);
  const knownBudgetBlock = await fetchAgentExecutionOutcome(async () => ({ ok: false, status: 503, json: async () => ({ status: 'blocked', error: { code: 'mission_budget_settlement_pending' } }) }), endpoint, init);
  assert.equal(knownBudgetBlock.kind, 'response');
  assert.equal(knownBudgetBlock.body.error.code, 'mission_budget_settlement_pending');
  const knownProviderFailure = await fetchAgentExecutionOutcome(async () => ({ ok: true, status: 200, json: async () => ({ status: 'failed', error: { code: 'provider_error' } }) }), endpoint, init);
  assert.equal(knownProviderFailure.kind, 'response');
  assert.equal(knownProviderFailure.body.status, 'failed');
  console.log('AGENT DIRECT EXECUTION RUNTIME RESPONSE-LOSS GUARD: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
