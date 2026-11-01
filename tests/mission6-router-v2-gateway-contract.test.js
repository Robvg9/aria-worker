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
  ok((gatewaySource.match(/payload\?\.status==='succeeded'&&response\.ok/g) || []).length === 2,
    'non-2xx responses cannot be accepted as successful executions');
  console.log('MISSION 6 ROUTER V2 FALLBACK GOVERNANCE:', count + ' assertions PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
