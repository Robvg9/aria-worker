'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function run() {
  // A1 — credential boundary exists and stays storage/authority agnostic.
  const credentialContract = read('credentials/contract.md');
  const credentialBoundary = read('credentials/boundary.js');
  assert.match(credentialContract, /credential_ref/);
  assert.match(credentialContract, /No secret is present in this repository/);
  assert.doesNotMatch(credentialBoundary, /process\.env|SUPABASE_SERVICE_ROLE|service_role_key/i);
  assert.match(credentialBoundary, /secret:\/\//);
  assert.match(credentialBoundary, /secret_output_blocked/);

  // A2 — durable human approval store + migration + adapter exist.
  const approvalContract = read('approvals/contract.md');
  const approvalStore = read('approvals/store.js');
  const approvalAdapter = read('approvals/supabase-adapter.js');
  const approvalMigration = read('supabase/migrations/20260902_block_a_approval_store.sql');
  assert.match(approvalContract, /durable Supabase store schema/);
  assert.match(approvalContract, /verification_ref/);
  assert.match(approvalStore, /pending.*approved.*rejected.*expired.*revoked/);
  assert.match(approvalStore, /selected|approved|risk_class|verification_ref/);
  assert.match(approvalAdapter, /execution_approvals/);
  assert.match(approvalMigration, /revoke all on table aria_internal\.execution_approvals from anon/i);
  assert.match(approvalMigration, /revoke all on table aria_internal\.execution_approvals from authenticated/i);
  assert.match(approvalMigration, /verification_ref ~ '\^verify:\/\//i);

  // A3 — observation boundary exists; it cannot itself grant execution authority.
  const healthContract = read('health/contract.md');
  const healthProbe = read('health/probe.js');
  const httpProbe = read('health/http-probe.js');
  assert.match(healthContract, /unknown/);
  assert.match(healthContract, /does not execute providers/);
  assert.match(healthProbe, /probe_not_configured/);
  assert.match(healthProbe, /insufficient_evidence/);
  assert.match(httpProbe, /https_required/);
  assert.match(httpProbe, /GET.*HEAD/);
  assert.match(httpProbe, /AbortController/);

  // No Block A artifact may contain obvious live secrets.
  const files = [
    'credentials/contract.md', 'credentials/boundary.js',
    'approvals/contract.md', 'approvals/store.js', 'approvals/supabase-adapter.js',
    'health/contract.md', 'health/probe.js', 'health/http-probe.js',
    'supabase/migrations/20260902_block_a_approval_store.sql'
  ];
  for (const file of files) {
    const content = read(file);
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE|service_role_key|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,}/i, `${file} appears to contain secret material`);
  }

  console.log('PASS: Block A cross-layer integrity');
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
