'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('supabase/functions/aria-app-api-v3/index.ts', 'utf8');
const engine = fs.readFileSync('supabase/functions/_shared/absorb-engine.mjs', 'utf8');

for (const needle of [
  'absorb-engine.mjs',
  'capability_absorptions',
  'path.endsWith("/absorb")',
  'path.endsWith("/absorb/inspect")',
  'path.endsWith("/absorb/verify")',
  'path.endsWith("/absorb/register")',
  'path.endsWith("/absorb/enable")',
  'external_code_execution',
  'runtime_binding',
  'tool_ecc_operator',
  'evaluateAbsorptionCompletion',
  'completion'
]) assert.ok(app.includes(needle), 'missing absorb contract: ' + needle);

assert.match(engine, /external_code_execution:"FORBIDDEN"/);
assert.match(engine, /activation_requires_registered_binding:true/);
assert.match(engine, /auto_execute:false/);
assert.match(engine, /github_url_not_allowed/);

const sql = fs.readFileSync('supabase/migrations/20261002170000_aria_absorb_v1.sql', 'utf8');
assert.match(sql, /capability_absorptions/);
assert.match(sql, /enable row level security/);
assert.match(sql, /revoke all on aria_internal\.capability_absorptions/);

console.log('absorb-app-api-contract: PASS');
