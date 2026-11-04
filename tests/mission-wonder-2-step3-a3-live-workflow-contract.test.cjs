'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'mission-wonder-2-step3-a3-live.yml');
const source = fs.readFileSync(workflowPath, 'utf8');
const pwaFastDeployPath = path.join(__dirname, '..', '.github', 'workflows', 'aria-pwa-fast-deploy.yml');
const pwaFastDeploy = fs.readFileSync(pwaFastDeployPath, 'utf8');
const pwaIgnoreStart = pwaFastDeploy.indexOf("    paths-ignore:");
const pwaIgnoreEnd = pwaFastDeploy.indexOf("  workflow_dispatch:", pwaIgnoreStart);
const pwaFastDeployIgnore = pwaIgnoreStart >= 0 && pwaIgnoreEnd > pwaIgnoreStart
  ? pwaFastDeploy.slice(pwaIgnoreStart, pwaIgnoreEnd)
  : '';
for (const a3OnlyPath of [
  '.github/workflows/mission-wonder-2-step3-a3-contract.yml',
  '.github/workflows/mission-wonder-2-step3-a3-live.yml',
  'autonomy/worker-single-instance-lock-v1.js',
  'tests/mission-wonder-2-step3-a3-presence.test.mjs',
  'tests/mission-wonder-2-step3-a3-live-workflow-contract.test.cjs',
  'tests/worker-single-instance-lock-v1.test.js'
]) {
  assert.ok(pwaFastDeployIgnore.includes(`      - '${a3OnlyPath}'`), `PWA Fast Lane must ignore A3-only path: ${a3OnlyPath}`);
}

assert.match(source, /^name: A3 LIVE Presence-Only Pilot$/m, 'GitHub Actions must receive an explicit simple workflow display name');
assert.match(source, /^on:\s*\n  workflow_dispatch:/m, 'the live A3 pilot must be manual-only');
assert.doesNotMatch(source, /^  (push|pull_request):/m, 'the live pilot must never run on a push or PR');
assert.match(source, /confirm_live_presence_only_pilot:[\s\S]{0,300}default: false/m, 'live pilot needs an explicit false-by-default confirmation');
assert.match(source, /environment: production/m, 'Cloudflare production deployment must pass through the production environment gate');
assert.match(source, /robvg-presence-recovery:[\s\S]{0,220}environment: production/m, 'physical ROBVG execution requires its own production approval');
assert.match(source, /RUNNER_NAME -ne 'ARIA-WINDOWS'[\s\S]{0,100}COMPUTERNAME -ne 'ROBVG'/m, 'physical pilot must fail closed on any runner other than ARIA-WINDOWS on ROBVG');
assert.ok(source.includes('        shell: powershell -NoProfile -ExecutionPolicy Bypass -File {0}'), 'physical A3 PowerShell step must bypass execution policy only for its generated process script');
assert.match(source, /function Write-A3SafeProcessDiagnostics/, 'physical pilot must preserve worker process diagnostics');
assert.match(source, /\$runtimeModules = @\([\s\S]{0,220}autonomy\/persistent-worker-error-policy-v1\.js[\s\S]{0,180}autonomy\/worker-single-instance-lock-v1\.js/m, 'physical pilot must preflight both worker runtime modules before opening a scope');
assert.match(source, /A3_WORKSPACE_COMMIT_MISMATCH/, 'physical pilot must confirm the runner workspace is checked out at the dispatched commit');
assert.match(source, /rev-parse "HEAD:\$relativePath"/, 'physical pilot must resolve each dependency to its exact Git tree blob before restoration');
assert.match(source, /ls-files --stage -- \$relativePath/, 'physical pilot must report the runner index entry when a dependency is absent');
assert.match(source, /cat-file','blob',blobSha/, 'physical pilot must restore missing dependencies from the Git object database rather than a pathspec checkout');
assert.match(source, /writeFileSync\(target,content\)/, 'physical pilot must write the exact tracked dependency bytes to the worktree');
assert.match(source, /hash-object',target/, 'physical pilot must verify the restored file matches the original Git blob');
assert.match(source, /A3_RUNTIME_MODULE_RESTORE_FROM_OBJECT=/, 'physical pilot must log when it restores a missing tracked dependency');
assert.match(source, /require\.resolve\(name\)/, 'physical pilot must verify Node resolves its runtime modules from the worker directory');
assert.match(source, /A3_RUNTIME_DEPENDENCY_PREFLIGHT=PASS/, 'physical pilot must report the module preflight before starting the presence scope');
assert.match(source, /A3_NODE_VERSION=/, 'worker diagnostics must include the selected Node runtime version');
assert.match(source, /ReadAllText\(\$entry\.Path, \[System\.Text\.Encoding\]::UTF8\)/, 'worker diagnostics must read UTF-8 process logs consistently');
assert.match(source, /\$raw = \$raw\.Replace\(\[string\]\$secret, '\[REDACTED\]'\)/, 'worker diagnostics must redact all configured credentials and scope tokens');
assert.match(source, /Write-A3SafeProcessDiagnostics -Label 'first-worker-exited-early'/, 'early first-worker termination must emit stdout and stderr diagnostics');
assert.match(source, /Write-A3SafeProcessDiagnostics -Label 'first-worker-heartbeat-timeout'/, 'missing first-worker heartbeats must emit stdout and stderr diagnostics');
assert.match(source, /Write-A3SafeProcessDiagnostics -Label 'recovery-worker-exit-nonzero'/, 'recovery-worker failures must emit stdout and stderr diagnostics');
assert.match(source, /wrangler deploy --config wrangler\.aria-autonomy\.toml/m, 'only the isolated coordinator may be deployed');
assert.doesNotMatch(source, /ARIA_RUNTIME_SHARED_SECRET|supabase db|supabase migration|supabase functions deploy/i, 'A3 must not touch the legacy runtime secret or Supabase');
assert.doesNotMatch(source, /Enable-ScheduledTask|Start-ScheduledTask|Register-ScheduledTask|Set-ScheduledTask/m, 'A3 must never enable or start the persistent task');
assert.match(source, /ttl_ms = 180000/m, 'the pilot TTL must stay within the three-minute cap');
assert.match(source, /CLOSE_MISSION_WONDER_2_A3_PRESENCE_ONLY/m, 'the workflow must close/revoke its scope in finally');
assert.match(source, /ARIA_MW2_A3_PRESENCE_SCOPE_TOKEN/m, 'the worker must use the one-shot A3 scope token');
assert.match(source, /Stop-Process -Id \$workerOne\.Id -Force/m, 'the recovery pilot must deliberately simulate a bounded worker-process crash');
assert.match(source, /A3_STALE_HEARTBEAT_DETECTION=PASS/m, 'the workflow must verify stale-heartbeat detection');
assert.match(source, /A3_ZERO_ORPHAN_WORKER_PROCESSES=PASS/m, 'the workflow must verify no worker process is left behind');

process.stdout.write('MISSION_WONDER_2_A3_LIVE_WORKFLOW_GUARDS=PASS\n');
