'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const execution = read('supabase/functions/aria-execution-runtime-v1/index.ts');
const gateway = read('supabase/functions/aria-device-gateway/index.ts');
const probe = read('supabase/functions/aria-groq-direct-live-check-v1/index.ts');
const deploy = read('.github/workflows/supabase-canonical-deploy.yml');

assert.match(execution, /const MISSION_EXECUTION_PAUSED = true/);
assert.match(execution, /if\(MISSION_EXECUTION_PAUSED\)return out\(\{status:"paused"/);
assert.match(execution, /async function groqChat\(route:any,input:any\)/);
assert.match(execution, /route\.account_id!=="acct_groq_primary"/);
assert.match(execution, /route\.model_id!=="groq\/openai\/gpt-oss-120b"/);
assert.match(execution, /secret\("groq\/groq_primary"\)/);
assert.match(execution, /https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions/);
assert.match(execution, /max_completion_tokens:Math\.max\(1,Math\.min\(Math\.floor\(requested\),2048\)\)/);
assert.match(execution, /x-ratelimit-remaining-requests/);
assert.match(execution, /if\(route\.provider_id==="groq"\)return groqChat\(route,input\)/);
assert.match(execution, /gsk_\[A-Za-z0-9_-\]\{12,\}/);

assert.equal((gateway.match(/\.in\('provider_id',\['google','groq','openrouter'\]\)/g) || []).length, 2);
assert.match(gateway, /'groq\/openai\/gpt-oss-120b'/);
assert.match(gateway, /'groq\/openai\/gpt-oss-120b':\{provider_id:'groq',account_id:'acct_groq_primary'\}/);
assert.match(gateway, /const providerOrder:Record<string,number>=\{google:0,groq:1,openrouter:2\}/);

assert.match(probe, /request\.method !== "GET"/);
assert.match(probe, /aria_consume_diagnostic_nonce/);
assert.match(probe, /p_nonce_name: "groq_direct_live_check"/);
assert.match(probe, /secret\("groq\/groq_primary"\)/);
assert.match(probe, /ARIA_GROQ_DIRECT_LIVE_OK/);
assert.match(probe, /rate_limit: headers/);
assert.doesNotMatch(probe, /GROQ_API_KEY\s*=\s*["'][^"']+["']/);

assert.match(deploy, /supabase functions deploy aria-groq-direct-live-check-v1/);
assert.match(deploy, /supabase functions deploy aria-execution-runtime-v1/);
assert.match(deploy, /supabase functions deploy aria-device-gateway/);

console.log('GROQ LIVE RUNTIME CONTRACT: PASS — direct adapter, gateway discovery, bounded single-shot probe, quota headers, nonce protection and mission freeze verified');
