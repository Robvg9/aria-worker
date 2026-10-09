'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const oauthPath = path.join(root, 'supabase/functions/aria-mcp-inbound-grok-v1/index.ts');
const runtimePath = path.join(root, 'supabase/functions/aria-github-app-runtime-v1/index.ts');
const migrationPath = path.join(root, 'supabase/migrations/20261009150000_aria_mcp_cuevacoin_control_oauth_scope_v1.sql');
const oauth = fs.readFileSync(oauthPath, 'utf8');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const migration = fs.readFileSync(migrationPath, 'utf8');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, 'missing start marker: ' + startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'missing end marker: ' + endMarker);
  return source.slice(start, end);
}

// Target identity is fixed in code, not client-supplied.
assert.match(oauth, /owner:"Robvg9",repo:"CuevaCoin",projectRef:"zqgmjwfvluboiporytcq"/);
assert.match(oauth, /const CUEVACOIN_CONTROL_SCOPE = "aria\.project\.cuevacoin\.control"/);
assert.match(oauth, /const SUPPORTED_SCOPES = \[SCOPE, CUEVACOIN_CONTROL_SCOPE\]/);
assert.match(worker, /const SCOPES = \["aria\.mcp\.inbound", "aria\.project\.cuevacoin\.control"\]/);
assert.match(worker, /scopes_supported:SCOPES/);
assert.match(oauth, /scopes_supported: SUPPORTED_SCOPES/);
assert.ok(oauth.includes('cuevacoin_connection_status'));
assert.ok(oauth.includes('cuevacoin_project_control'));

// Pending OAuth state now stores scope, and the migration backfills old state safely.
const authorizeBlock = between(oauth, 'if (req.method === "GET" && path.endsWith("/authorize"))', 'if (req.method === "POST" && path.endsWith("/authorize/consent"))');
assert.match(authorizeBlock, /scope:\s*grantedScope/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS scope text/);
assert.match(migration, /SET scope = 'aria\.mcp\.inbound'/);
assert.match(migration, /ALTER COLUMN scope SET DEFAULT 'aria\.mcp\.inbound'/);
assert.match(migration, /ALTER COLUMN scope SET NOT NULL/);

// The elevated consent input is emitted inside the ALLOW form, not outside it or inside DENY.
const consent = between(oauth, 'function consentPage(', '\nDeno.serve(async (req) => {');
const allowFormStart = consent.indexOf('<form method="post" action="${ISSUER}/authorize/consent">');
assert.notEqual(allowFormStart, -1);
const allowFormEnd = consent.indexOf('</form>', allowFormStart);
const controlFieldInsertion = consent.indexOf('${controlField}', allowFormStart);
assert.ok(controlFieldInsertion > allowFormStart && controlFieldInsertion < allowFormEnd);
assert.ok(consent.includes('control_confirmation'));
assert.match(oauth, /String\(form\.get\("control_confirmation"\)\|\|""\)!=="AUTHORIZE CUEVACOIN CONTROL"/);

// Access token and refresh token both preserve only validated scopes.
assert.match(oauth, /tokenScopes\.some\(\(value\) => value !== "openid" && !SUPPORTED_SCOPES\.includes\(value\)\)/);
assert.match(oauth, /const grantedScope=String\(record\.scope\|\|SCOPE\)/);
assert.match(oauth, /return \{ clientId: data\.client_id, scope: String\(data\.scope \|\| SCOPE\) \}/);
assert.match(oauth, /if\(!scopes\.includes\(CUEVACOIN_CONTROL_SCOPE\)\)/);

// Writes must name the exact project and carry a summarized, risk-classified confirmation.
assert.match(oauth, /production_write_confirmation_required/);
assert.match(oauth, /production_project_confirmation_mismatch/);
assert.match(oauth, /change_summary_required/);
assert.match(oauth, /manual_review_required/);
assert.match(oauth, /I AUTHORIZE THIS CUEVACOIN CHANGE/);
assert.match(oauth, /MERGE CUEVACOIN PR #/);
assert.match(runtime, /"robvg9\/cuevacoin"/i);
assert.match(runtime, /reviewed_file_write/);
assert.match(runtime, /workflow_dispatch/);

// Status/read paths return only masked state; the management credential is retrieved from Vault.
assert.match(oauth, /credential_read_secret/);
assert.match(oauth, /secret_name:CUEVACOIN_PROJECT\.managementTokenSecretName/);
assert.doesNotMatch(oauth, /return\s*\{\s*managementToken\s*:/i);


// The dedicated OAuth workflow must deploy checked-in code, not overwrite it from an old SHA.
const inboundDeployWorkflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-aria-mcp-inbound-grok.yml'), 'utf8');
assert.match(inboundDeployWorkflow, /workflow_dispatch:/);
assert.ok(!/^\s*push:/m.test(inboundDeployWorkflow), 'OAuth deployment must not auto-deploy concurrently with canonical Supabase deploy');
assert.doesNotMatch(inboundDeployWorkflow, /git show 3162e4aa/);
assert.doesNotMatch(inboundDeployWorkflow, /git push origin HEAD:main/);
assert.ok(inboundDeployWorkflow.includes('aria.project.cuevacoin.control'));
assert.match(inboundDeployWorkflow, /WORKER_PRM_OK/);
console.log('aria-mcp-inbound-deploy-no-historical-overwrite: PASS');


// Production Cloudflare OAuth smoke checks must accept both the base and governed CuevaCoin scopes.
const cloudflareDeployWorkflow = fs.readFileSync(path.join(root, '.github/workflows/aria-cloudflare-deploy.yml'), 'utf8');
assert.ok(!cloudflareDeployWorkflow.includes("scopes_supported']==['aria.mcp.inbound']"), 'OAuth smoke test must not require the obsolete single-scope list');
assert.ok(cloudflareDeployWorkflow.includes("aria.project.cuevacoin.control"), 'OAuth smoke test must require the new governed CuevaCoin scope');
console.log('cloudflare-oauth-scope-parity-contract: PASS');

console.log('aria-cuevacoin-control-v1: PASS');
