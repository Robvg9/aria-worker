'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20261005012500_reconcile_gemini_direct_model_registry_v1.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

for (const fragment of [
  "google/gemini-3.5-flash-lite-direct",
  "status = 'available'",
  "enabled = true",
  "aria_internal.provider_registry",
  "integration_status = 'connected'",
  "aria_internal.capability_matrix",
  "capability_id = 'text_generation'",
  "c.status = 'verified'",
  "aria-gemini-direct-live-check-v1",
  "live_probe_verification",
  "router-cert-gemini-direct-20261005-001"
]) {
  assert.ok(migration.includes(fragment), fragment);
}

assert.match(
  migration,
  /where m\.model_id = 'google\/gemini-3\.5-flash-lite-direct'/
);
assert.match(
  migration,
  /on conflict \(decision_id\) do nothing/
);

console.log('GEMINI DIRECT MODEL REGISTRY RECONCILIATION CONTRACT: PASS');
