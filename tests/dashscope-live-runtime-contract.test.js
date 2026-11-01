'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const execution = read('supabase/functions/aria-execution-runtime-v1/index.ts');
const gateway = read('supabase/functions/aria-device-gateway/index.ts');
const probe = read('supabase/functions/aria-dashscope-direct-live-check-v1/index.ts');
const deploy = read('.github/workflows/supabase-canonical-deploy.yml');

const paused = execution.indexOf('if(MISSION_EXECUTION_PAUSED)');
const providerDispatch = execution.indexOf('if(route.provider_id==="alibaba_dashscope")return dashscopeChat(route,input)');
assert.ok(paused >= 0 && providerDispatch > paused, 'mission freeze must precede all provider dispatch');

assert.ok(execution.includes('async function dashscopeChat(route:any,input:any)'));
assert.ok(execution.includes('route.account_id!=="acct_dashscope_primary"'));
assert.ok(execution.includes('route.model_id!=="alibaba_dashscope/qwen3.8-max"'));
assert.ok(execution.includes('secret("dashscope/qwen_primary")'));
assert.ok(execution.includes('credential.free_quota_only!==true'));
assert.ok(execution.includes('credential.free_quota_expires_at'));
assert.ok(execution.includes('credential.region!=="ap-southeast-1"'));
assert.ok(execution.includes('https://${credential.workspace_id}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'));
assert.ok(execution.includes('max_tokens:Math.max(1,Math.min(Math.floor(requested),2048))'));
assert.ok(execution.includes('providerCode==="AllocationQuota.FreeTierOnly"?"quota_exhausted"'));

assert.equal((gateway.match(/\.in\('provider_id',\['google','alibaba_dashscope','openrouter'\]\)/g) || []).length, 2);
assert.ok(gateway.includes("'alibaba_dashscope/qwen3.8-max'"));
assert.ok(gateway.includes("m?.metadata?.free_quota_only===true"));
assert.ok(gateway.includes("m?.metadata?.free_quota_expires_at"));
assert.ok(gateway.includes("const providerOrder:Record<string,number>={google:0,alibaba_dashscope:1,openrouter:2}"));
assert.ok(gateway.includes("'alibaba_dashscope/qwen3.8-max':{provider_id:'alibaba_dashscope',account_id:'acct_dashscope_primary'}"));
assert.ok(gateway.includes("a.credential_ref!=='secret://dashscope/qwen_primary'||a.secret_present!==true"));
assert.ok(gateway.includes("supabase.schema('aria_internal').from('model_registry')"));
assert.ok(gateway.includes("supabase.schema('aria_internal').from('capability_matrix')"));
assert.ok(gateway.includes("supabase.schema('aria_internal').from('credential_registry')"));
assert.ok(gateway.includes("dashscope_model_or_free_quota_not_live_verified"));
assert.ok(gateway.includes("dashscope_account_or_credential_not_live_verified"));

assert.ok(probe.includes('request.method !== "GET"'));
assert.ok(probe.includes('aria_consume_diagnostic_nonce'));
assert.ok(probe.includes('p_nonce_name: "dashscope_qwen_direct_live_check"'));
assert.ok(probe.includes('secret("dashscope/qwen_primary")'));
assert.ok(probe.includes('credential.free_quota_only !== true'));
assert.ok(probe.includes('credential.free_quota_expires_at'));
assert.ok(probe.includes('ARIA_DASHSCOPE_QWEN_LIVE_OK'));
assert.ok(probe.includes('AllocationQuota.FreeTierOnly'));
assert.ok(probe.includes('free_quota_guard: "free_quota_only"'));
assert.ok(!/DASHSCOPE_API_KEY\s*=\s*["'][^"']+["']/.test(probe));

assert.ok(deploy.includes('supabase functions deploy aria-dashscope-direct-live-check-v1'));
assert.ok(deploy.includes('supabase functions deploy aria-execution-runtime-v1'));
assert.ok(deploy.includes('supabase functions deploy aria-device-gateway'));

console.log('DASHSCOPE LIVE RUNTIME CONTRACT: PASS — route/account/model guard, Free Quota Only expiry, one-shot nonce, usage, and mission freeze verified');
