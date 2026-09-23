'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/functions/aria-device-gateway/index.ts'), 'utf8');

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

assert.ok(source.includes('executionJobDbCall'));
assert.ok(source.includes('SUPABASE_DB_URL'));
assert.ok(source.includes("public.claim_execution_job_gateway"));
assert.ok(source.includes("public.start_execution_job_gateway"));
assert.ok(source.includes("public.complete_execution_job_gateway"));
assert.ok(source.includes("connect_timeout:5"));
assert.ok(source.includes("execution_job_db_url_unavailable"));
