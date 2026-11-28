'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('supabase/functions/aria-device-gateway/index.ts','utf8');
for(const marker of [
  "/v1/router/decide",
  "/v1/router/execute",
  "/v1/router/parallel-execute",
  "Promise.all",
  "router_live_snapshot",
  "record_router_decision",
  "parallel_plan",
  "fallback_used",
  "required_tools_unavailable",
  "specialist_agent_required"
]) assert.ok(source.includes(marker),'missing Mission 6 gateway marker: '+marker);

const androidDecisionSource=source.slice(source.indexOf('async function androidAutonomousDecision'),source.indexOf('async function androidAutonomous'));
assert.ok(androidDecisionSource.includes("a.account_id==='acct_google_gemini_free'"),
  'Google Direct free exception must bind to the dedicated free account');
assert.ok(androidDecisionSource.includes('verifiedPricingEvidence(m.pricing,identity)')&&androidDecisionSource.includes('verifiedZeroPricing(m.pricing)'),
  'OpenRouter Android free route must have observed, verified, identity-bound zero pricing');
assert.ok(!androidDecisionSource.includes("pricing?.tier==='free'")&&!androidDecisionSource.includes("metadata?.free_tier===true"),
  'unverified free labels cannot qualify Android autonomous routes');
assert.ok(source.includes("function m6PriceNumber(v:any){return typeof v==='number'&&Number.isFinite(v)?v:null}"),
  'null or numeric-string pricing cannot be coerced into a verified zero');
assert.ok(source.includes('function m6FreeCost(p:any,identity:any)')&&source.includes('verifiedPricingEvidence(p,identity)'),
  'Mission 6 cost scoring must require identity-bound source evidence');

const agentRuntimeSource=fs.readFileSync('supabase/functions/aria-agent-runtime-v1/index.ts','utf8');
const geminiLiveCheckSource=fs.readFileSync('supabase/functions/aria-gemini-direct-live-check-v1/index.ts','utf8');
const mission5ModelSource=source.slice(source.indexOf('async function mission5ModelProbe'),source.indexOf('async function mission5AgentProbe'));
const mission5AgentSource=source.slice(source.indexOf('async function mission5AgentProbe'),source.indexOf('async function markMeditationNotificationsRead'));
const routerExecuteSource=source.slice(source.indexOf('async function intelligentRouterExecute'),source.indexOf('async function intelligentRouterParallelExecute'));
const routerParallelSource=source.slice(source.indexOf('async function intelligentRouterParallelExecute'),source.indexOf('function objectiveHumanGate'));
const allForOneModelSource=source.slice(source.indexOf('async function runModelAuditor'),source.indexOf('async function allForOneStart'));
const rwhtProbeSource=source.slice(source.indexOf("if(req.method==='POST'&&p==='/v1/rwht-model-probe')"),source.indexOf("if(req.method==='GET'&&p==='/health')"));
assert.ok(mission5ModelSource.includes("if(!missionId||!stepId)return {ok:false,status:'blocked'"),
  'Mission 5 direct model probes require a real mission and step');
assert.ok(mission5ModelSource.includes("request_id:requestId")&&mission5ModelSource.includes("metadata:{mission_id:missionId,step_id:stepId"),
  'Mission 5 model probes bind the request key and metadata to the same mission/step');
assert.ok(mission5AgentSource.includes("if(!missionId||!stepId)return {ok:false,status:'blocked'")&&!mission5AgentSource.includes("mission5-agent-probe-'+crypto.randomUUID()"),
  'Mission 5 agent probes must not manufacture synthetic mission identity');
assert.ok(mission5AgentSource.includes("upstreamCode.startsWith('mission_budget_')")&&mission5AgentSource.includes("status:errorCode.startsWith('mission_budget_')?'blocked':'failed'"),
  'Mission 5 agent probe must preserve upstream budget denial instead of converting it to a generic error');
assert.ok(agentRuntimeSource.includes('const requestId = `${missionId}:${stepId}:${crypto.randomUUID()}`;'),
  'agent runtime request IDs use mission:step:nonce identity');
assert.ok(routerExecuteSource.includes("if(!missionId||!stepId)return{status:'blocked',reason:'mission_budget_mission_context_missing'}"),
  'Mission 6 single router requires explicit mission and step identity');
assert.ok(routerExecuteSource.includes("request_id:`${missionId}:${stepId}:${crypto.randomUUID()}`")&&routerExecuteSource.includes("metadata:{mission_id:missionId,step_id:stepId"),
  'Mission 6 single router passes a matching budget identity to runtime');
assert.ok(routerExecuteSource.includes("if(budgetErrorCode.startsWith('mission_budget_'))return{status:'blocked'"),
  'Mission 6 single router stops fallback on any budget gate error');
assert.ok(routerParallelSource.includes("if(!missionId)return{status:'blocked',reason:'mission_budget_mission_context_missing'}")&&routerParallelSource.includes("request_id:`${missionId}:${stepId}:${crypto.randomUUID()}`"),
  'Mission 6 parallel router binds each task attempt to a mission and step');
assert.ok(routerParallelSource.includes("if(budgetErrorCode.startsWith('mission_budget_'))return{task_id:taskId,status:'blocked'"),
  'Mission 6 parallel router stops route fallback on budget gate error');
assert.ok(allForOneModelSource.includes("MODEL REVIEW BLOCKED: All-for-One audit run has no mission_state-backed mission ID"),
  'unscoped All-for-One reviewer is blocked rather than assigned a synthetic mission');
assert.ok(rwhtProbeSource.includes("mission_budget_mission_context_missing")&&!rwhtProbeSource.includes("await internalFunctionFetch"),
  'unscoped RWHT direct model probe is blocked before runtime/provider dispatch');
assert.ok(source.includes("function gatewayMissionBudgetOutcomeUnknown("),
  'device gateway must expose one terminal internal-runtime outcome helper');
assert.ok(mission5ModelSource.includes("mission_budget_execution_runtime_outcome_unknown"),
  'Mission 5 model probe must stop after its internal execution response is lost');
assert.ok(mission5AgentSource.includes("mission_budget_agent_runtime_outcome_unknown"),
  'Mission 5 agent probe must stop after its internal agent response is lost');
assert.ok(routerExecuteSource.includes("mission_budget_execution_runtime_outcome_unknown"),
  'Mission 6 single route must stop on a lost execution-runtime response');
assert.ok(routerParallelSource.includes("mission_budget_execution_runtime_outcome_unknown"),
  'Mission 6 parallel task must stop on a lost execution-runtime response');
assert.ok(routerParallelSource.includes("if(budgetBlocked)return {status:'blocked'"),
  'Mission 6 parallel gateway must propagate a blocked budget outcome to the whole batch');
assert.ok(source.includes("if(probeBudgetError.startsWith('mission_budget_'))"),
  'Autonomous Mission 5 route selection must not try a different model after a budget block');
console.log('MISSION 6 ROUTER V2 GATEWAY CONTRACT: PASS');

(async () => {
  const {
    m6ClassifyFallbackFailure,
    m6FallbackRouteKey,
    m6GovernFallback
  } = await import('../supabase/functions/aria-device-gateway/_shared/fallback-governance-v1.mjs');
  let count = 0;
  const ok = (condition, label) => {
    assert.ok(condition, label);
    count++;
    console.log('PASS:', label);
  };
  const primary = { provider_id: 'google', account_id: 'acct_google', model_id: 'google/model-a' };
assert.ok(source.includes("e.provider_id===identity?.provider_id")&&source.includes("e.account_id===identity?.account_id")&&source.includes("e.model_id===identity?.model_id"),
  'pricing evidence must match the selected provider, account and model exactly');
assert.ok(source.includes('i===0&&o===0?1:.5'), 'only verified two-sided zero pricing receives the free-tier score');
  const sameAccountOtherModel = { provider_id: 'google', account_id: 'acct_google', model_id: 'google/model-b' };
  const sameProviderOtherAccount = { provider_id: 'google', account_id: 'acct_google_2', model_id: 'google/model-c' };
  const alternate = { provider_id: 'mistral', account_id: 'acct_mistral', model_id: 'mistral/model-a' };

  ok(m6ClassifyFallbackFailure({ error: { provider_status: 429, code: 'rate_limit' } }, 402) === 'quota_exhausted',
    'outer HTTP 402 overrides contradictory nested 429');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 402, message: 'insufficient credits' } }, 200) === 'quota_exhausted',
    'wrapped provider HTTP 402 is detected through HTTP 200');
  ok(m6ClassifyFallbackFailure({ error: 'insufficient credits' }, 200) === 'quota_exhausted',
    'insufficient-credit message is classified as quota exhaustion');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 429 } }, 200) === 'rate_limit',
    'nested HTTP 429 remains a separate rate-limit class');
  ok(m6ClassifyFallbackFailure({ error: { code: 'rate_limit' } }, 200) === 'rate_limit',
    'rate-limit code is recognized');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 401 } }, 200) === 'account_unavailable',
    'HTTP 401 invalidates the account route');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 403 } }, 200) === 'account_unavailable',
    'HTTP 403 blocks the account route');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 408 } }, 200) === 'timeout',
    'HTTP 408 is classified as timeout');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 504 } }, 200) === 'timeout',
    'HTTP 504 is classified as timeout');
  ok(m6ClassifyFallbackFailure({ error: { provider_status: 503 } }, 200) === 'provider_unavailable',
    'HTTP 5xx is classified as provider unavailable');
  ok(m6ClassifyFallbackFailure({ error: { code: 'execution_failure' } }, 200) === 'execution_failure',
    'unrecognized execution errors remain distinct');

  const quotaFallbacks = m6GovernFallback(primary,
    [sameAccountOtherModel, sameProviderOtherAccount, alternate, alternate],
    'quota_exhausted');
  ok(quotaFallbacks.length === 1 && quotaFallbacks[0].provider_id === 'mistral',
    'quota exhaustion only permits a distinct provider and removes duplicates');
  ok(m6GovernFallback(primary, [alternate], 'rate_limit').length === 0,
    '429 fallback remains denied unless explicitly allowed');
  ok(m6GovernFallback(primary, [sameAccountOtherModel, sameProviderOtherAccount, alternate],
    'rate_limit', { allow_rate_limit_fallback: true }).length === 1,
    'explicit 429 fallback still forbids same-provider account hopping');
  ok(m6GovernFallback(primary, [sameAccountOtherModel, sameProviderOtherAccount, alternate],
    'provider_unavailable').length === 1,
    'provider outage excludes every route from the failed provider');
  ok(m6GovernFallback(primary, [sameAccountOtherModel, sameProviderOtherAccount, alternate],
    'account_unavailable').length === 2,
    'account failure excludes the failed account without suppressing other providers');
  ok(m6GovernFallback(primary, [alternate], 'quota_exhausted',
    { visited: [m6FallbackRouteKey(alternate)] }).length === 0,
    'visited route keys prevent a repeated fallback attempt');
  ok(m6FallbackRouteKey(primary) === 'google|acct_google|google/model-a',
    'attempt identity is deterministic');

  const gatewaySource = require('node:fs').readFileSync(
    'supabase/functions/aria-device-gateway/index.ts', 'utf8');
  ok((gatewaySource.match(/m6ClassifyFallbackFailure\(payload,response\.status\)/g) || []).length === 2,
    'individual and parallel gateway execution pass both payload and outer HTTP status');
  ok((gatewaySource.match(/m6GovernFallback\(selected,routes/g) || []).length === 2,
    'individual and parallel fallback governance use the currently failing route');
  ok((gatewaySource.match(/if\(payload\?\.status==='succeeded'&&response\.ok\)/g) || []).length === 2,
    'non-2xx responses cannot be accepted as successful executions');
  
assert.ok(geminiLiveCheckSource.includes("mission_budget_mission_context_missing"),
  'Gemini diagnostic probe requires an explicit mission and step');
assert.ok(geminiLiveCheckSource.includes('aria-execution-runtime-v1') &&
  geminiLiveCheckSource.includes('metadata:') &&
  geminiLiveCheckSource.includes('mission_id: missionId') &&
  geminiLiveCheckSource.includes('step_id: stepId'),
  'Gemini live diagnostic probe routes through the shared budget runtime');
assert.ok(!geminiLiveCheckSource.includes('generativelanguage.googleapis.com') &&
  !geminiLiveCheckSource.includes('GOOGLE_API_KEY'),
  'Gemini diagnostic edge function no longer bypasses the shared provider runtime');

console.log('MISSION 6 ROUTER V2 FALLBACK GOVERNANCE:', count + ' assertions PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
