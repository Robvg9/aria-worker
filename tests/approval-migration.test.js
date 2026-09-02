'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

function run() {
  const sql = fs.readFileSync(__dirname + '/../supabase/migrations/20260902_block_a_approval_store.sql', 'utf8');
  assert.match(sql, /create table if not exists aria_internal\.execution_approvals/i);
  assert.match(sql, /risk_class text not null check/i);
  assert.match(sql, /status text not null default 'pending' check/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table aria_internal\.execution_approvals from public/i);
  assert.match(sql, /revoke all on table aria_internal\.execution_approvals from anon/i);
  assert.match(sql, /revoke all on table aria_internal\.execution_approvals from authenticated/i);
  assert.doesNotMatch(sql, /service_role_key|SUPABASE_SERVICE_ROLE|Bearer\s+[A-Za-z0-9._-]{12,}/i);
  assert.doesNotMatch(sql, /\bpassword\s+(text|varchar|bytea)|\bpassphrase\s+(text|varchar|bytea)|\botp\s+(text|varchar|bytea)/i);
  assert.match(sql, /verification_ref text/);
  console.log('PASS: approval migration security contract tests');
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
