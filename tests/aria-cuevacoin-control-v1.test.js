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
assert.match(runtime, /if\(op==="pr_close"\)/);
assert.match(runtime, /if\(op==="delete_probe_branch"\)/);
assert.match(runtime, /temporary_probe_branch_required/);
assert.match(oauth, /github_file_write:"file_write"/);
assert.ok(oauth.includes('"github_pr_close"') && oauth.includes('"github_branch_delete"'));
assert.match(oauth, /select\("client_id, redirect_uris, client_name"\)/);
assert.ok(oauth.includes('client.client_name || (clientId.startsWith("aria_") ? "ARIA MCP Client" : clientId)'));
assert.ok(!oauth.includes('Restart from Grok.'), 'expired authorization must not direct ARIA clients to Grok');
assert.doesNotMatch(oauth.slice(oauth.indexOf('if (req.method === "GET" && path.endsWith("/authorize"))'), oauth.indexOf('if (req.method === "POST" && path.endsWith("/authorize/consent"))')), /"Grok Custom Connector"|"Grok \(CIMD\)"/);
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


const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');
assert.ok(oauth.includes('async function requireActiveCuevacoinControlGrant'));
assert.ok(oauth.includes('internal/mission-read-dispatch'));
assert.ok(oauth.includes('aria_mcp_oauth_refresh_tokens'));
assert.ok(oauth.includes('SERVICE_ROLE_KEY'));
assert.ok(oauth.includes('cuevacoinMissionReadDispatch'));
assert.ok(oauth.includes('supabase_edge_functions_list'));
assert.ok(oauth.includes('cuevacoin_read_tool_not_allowlisted'));
assert.ok(runner.includes('isCuevacoinAuthorizedReadMission'));
assert.ok(runner.includes('buildCuevacoinAuthorizedReadPlan'));
assert.ok(runner.includes('cuevacoinAuthorizedReadOnlyExecute'));
assert.ok(runner.includes('cuevacoin_control_verification_incomplete'));
assert.ok(runner.includes('allowed_external_operations: ["github_repo_read", "supabase_project_status", "supabase_edge_functions_list"]'));

// The production deployment path is separately goal-gated, fixed to one workflow,
// idempotent across retries, scope-gated, and requires fresh run + exact LIVE hashes.
assert.ok(runner.includes('isCuevacoinAuthorizedDeployMission'));
assert.ok(runner.includes('buildCuevacoinAuthorizedDeployPlan'));
assert.ok(runner.includes('cuevacoin_deploy_dispatch'));
assert.ok(runner.includes('cuevacoin_deploy_verify_live'));
assert.ok(runner.includes('cuevacoin_deployment_live_verification_incomplete'));
assert.ok(oauth.includes('internal/mission-deployment-dispatch'));
assert.ok(oauth.includes('cuevacoinMissionDeploymentDispatch'));
assert.ok(oauth.includes('cuevacoin_deployment_prior_dispatch_ambiguous_no_redispatch'));
assert.ok(oauth.includes('cuevacoin_deployment_workflow_source_not_verified'));
assert.ok(oauth.includes('cuevacoinVerifyLiveHashes'));
assert.ok(oauth.includes('source_sha256: sourceHash'));
assert.ok(oauth.includes('live_sha256: liveHash'));
assert.ok(runtime.includes('run_id:x.id'));
assert.ok(runtime.includes('event:x.event'));
assert.ok(runtime.includes('head_branch:x.head_branch'));
assert.ok(runtime.includes('created_at:x.created_at'));



const connectionStatus = between(oauth, 'async function cuevaCoinConnectionStatus()', 'async function cuevaCoinProjectControl(');
assert.match(connectionStatus, /ready_for_read_only_control:readyForReadOnlyControl/);
assert.match(connectionStatus, /ready_for_full_control:readyForFullControl/);
assert.match(connectionStatus, /const readyForFullControl=gh\.write_access==="verified"&&backend\.state==="connected"&&deployment\.state==="verified"/);
assert.match(connectionStatus, /deployment_control_verified:deployment\.state==="verified"/);
assert.match(connectionStatus, /github_repository_write_permission_not_verified/);


const deploymentRecovery = between(
  oauth,
  'if (String(state.request_id || "") === requestId && state.dispatch_state === "dispatching") {',
  '    const refResult: any = await cuevaCoinProjectControl({ operation: "github_ref_read", branch: "main" }, grant.client_id);'
);
assert.match(deploymentRecovery, /Date\.now\(\) - firstDispatchAt < 120_000/);
assert.match(deploymentRecovery, /state\.recovery_dispatch_attempted === true/);
assert.match(deploymentRecovery, /currentMainSha !== String\(state\.commit_sha \|\| ""\)/);
assert.match(deploymentRecovery, /recovery_dispatch_attempted:\s*true/);
assert.match(deploymentRecovery, /await persistCuevacoinDeploymentEvent\(missionId, requestId, recoveryIntent\)/);
assert.match(deploymentRecovery, /operation: "github_workflow_dispatch"/);
assert.match(deploymentRecovery, /recovery_dispatch_accepted:\s*true/);
assert.match(deploymentRecovery, /cuevacoin_deployment_recovery_dispatch_already_attempted_no_redispatch/);

const deploymentEvidenceReader = between(
  oauth,
  'async function cuevacoinDeploymentEvents(',
  'async function persistCuevacoinDeploymentEvent('
);
assert.match(deploymentEvidenceReader, /\.eq\("event_type",\s*"checkpoint_saved"\)/);
assert.match(deploymentEvidenceReader, /\.eq\("payload->>kind",\s*"cuevacoin_deployment_dispatch_state"\)/);

const deploymentEvidenceWriter = between(
  oauth,
  'async function persistCuevacoinDeploymentEvent(',
  'async function cuevacoinDeploymentRunForCommit('
);
assert.match(deploymentEvidenceWriter, /db\(\)\.rpc\("aria_mission_append_event"/);
assert.match(deploymentEvidenceWriter, /p_event:\s*\{/);
assert.match(deploymentEvidenceWriter, /event_type:\s*"checkpoint_saved"/);
assert.match(deploymentEvidenceWriter, /kind:\s*"cuevacoin_deployment_dispatch_state"/);
assert.match(deploymentEvidenceWriter, /request_id:\s*requestId/);
assert.match(deploymentEvidenceWriter, /execution_id:\s*executionId/);
assert.match(deploymentEvidenceWriter, /runtime_version:\s*runtimeVersion/);
assert.match(deploymentEvidenceWriter, /source_sha:\s*sourceSha/);
assert.doesNotMatch(deploymentEvidenceWriter, /\.schema\("aria_internal"\)\.from\("mission_events"\)\.insert/);
assert.doesNotMatch(deploymentEvidenceWriter, /event_type:\s*"cuevacoin_deployment_dispatch_state"/);


assert.match(oauth, /recoveryAgeMs < 120000/);
assert.match(oauth, /recoveryRetryCount >= 1/);
assert.match(oauth, /cuevacoin_deployment_main_changed_during_ambiguous_dispatch_no_redispatch/);
assert.match(oauth, /verified_no_matching_workflow_run_after_grace_period/);
assert.match(oauth, /recovered_after_ambiguous_dispatch/);
assert.doesNotMatch(oauth, /cuevacoinDeploymentRunForCommit\(grant\.client_id, String\(state\.commit_sha\), String\(state\.dispatched_at\)\)\.catch\(\(\) => null\)/);

console.log('aria-cuevacoin-control-v1: PASS');
