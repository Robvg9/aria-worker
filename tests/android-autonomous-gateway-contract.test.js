'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/functions/aria-device-gateway/index.ts'), 'utf8');
const canonical = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/functions/aria-canonical-runtime-v1/index.ts'), 'utf8');

assert.ok(source.includes('function internalFunctionFetch('), 'gateway-to-function calls must use the apikey-aware transport');
assert.ok(source.includes("headers.set('apikey',SUPABASE_API_KEY)"), 'gateway transport must identify the Supabase project separately from its shared Bearer secret');
assert.ok(!source.includes('await fetch(CANONICAL_RUNTIME,'), 'canonical runtime requests must not bypass the apikey-aware transport');
assert.ok(canonical.includes('SUPABASE_PUBLISHABLE_KEY'), 'canonical runtime should prefer the current publishable project key');
assert.ok(canonical.includes('"apikey":API_KEY'), 'canonical runner calls must send apikey separately from the service-role Authorization header');
assert.ok(!canonical.includes('fetch(RUNNER,'), 'canonical runner calls must not bypass the project API key');

for (const marker of [
  "/v1/android/autonomous/decide",
  "androidAutonomousDecision",
  "model_registry",
  "capability_matrix",
  "acct_google_gemini_free",
  "android_autonomous_decision",
  "human_gate_required_for_sensitive_action",
  "human_gate_required_for_credential_input",
  "responseMimeType:'application/json'",
  "autonomousUiNodeMap"
]) assert.ok(source.includes(marker), 'missing Android autonomous gateway marker: ' + marker);

assert.match(source, /\.in\(['"]provider_id['"],\s*\[\s*['"]google['"]/);
assert.match(source, /status','verified/);
assert.match(source, /allowedHosts/);
assert.match(source, /destructive/);

console.log('ANDROID AUTONOMOUS GATEWAY CONTRACT: PASS');

assert.ok(source.includes('executionJobGatewayCall'));
assert.ok(source.includes("SUPABASE_DB_URL"));
assert.ok(source.includes("postgres(dbUrl"));
assert.ok(source.includes("claim_execution_job_gateway"));
assert.ok(source.includes("start_execution_job_gateway"));
assert.ok(source.includes("complete_execution_job_gateway"));

const jobPath = source.slice(source.indexOf("if(req.method==='POST'&&p==='/v1/jobs/claim')"));
assert.ok(jobPath.includes("executionJobGatewayCall('claim'"));
assert.ok(jobPath.includes("transport:'supabase-rpc'"));
assert.ok(!jobPath.includes("transport:'postgrest-fallback'"));
