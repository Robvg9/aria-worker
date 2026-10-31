'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const legacyWorkflow = fs.readFileSync(path.join(root, '.github/workflows/aria-cloudflare-deploy.yml'), 'utf8');
const isolatedDeploy = fs.readFileSync(path.join(root, '.github/workflows/aria-autonomy-coordinator-deploy.yml'), 'utf8');
const pwaDeploy = fs.readFileSync(path.join(root, '.github/workflows/aria-pwa-fast-deploy.yml'), 'utf8');
const supabaseDeploy = fs.readFileSync(path.join(root, '.github/workflows/supabase-canonical-deploy.yml'), 'utf8');
const cloudWorker = fs.readFileSync(path.join(root, 'cloudflare-autonomy/worker.mjs'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler.aria-autonomy.toml'), 'utf8');
const persistentWorkflow = fs.readFileSync(path.join(root, '.github/workflows/persistent-autonomy-v1-tests.yml'), 'utf8');
const absorbWorkflow = fs.readFileSync(path.join(root, '.github/workflows/aria-absorb.yml'), 'utf8');
const windowsLauncher = fs.readFileSync(path.join(root, 'scripts/Start-ARIA-Persistent-Worker.ps1'), 'utf8');

assert.match(legacyWorkflow, /paths-ignore:/);
assert.match(legacyWorkflow, /workflow_dispatch:/);
const autonomyOnlyPaths = [
  '.github/workflows/aria-cloudflare-deploy.yml',
  '.github/workflows/aria-absorb.yml',
  '.github/workflows/aria-autonomy-coordinator-deploy.yml',
  '.github/workflows/aria-pwa-fast-deploy.yml',
  '.github/workflows/supabase-canonical-deploy.yml',
  '.github/workflows/persistent-autonomy-v1-tests.yml',
  '.github/workflows/aria-npm-test.yml',
  'Dockerfile.aria-coordinator',
  'autonomy/PERSISTENT_AUTONOMY_V1.md',
  'autonomy/ollama-persistent-adapter-v1.js',
  'autonomy/persistent-autonomy-v1.env.example',
  'autonomy/persistent-control-plane-v1.js',
  'autonomy/persistent-dashboard-v1.html',
  'autonomy/persistent-http-server-v1.js',
  'autonomy/persistent-notifications-v1.js',
  'autonomy/persistent-worker-bridge-v1.js',
  'autonomy/persistent-worker-error-policy-v1.js',
  'autonomy/persistent-worker-coordinator-adapter-v1.js',
  'pwa/src/testCatalog.ts',
  'cloudflare-autonomy/assets/index.html',
  'cloudflare-autonomy/worker.mjs',
  'scripts/Start-ARIA-Persistent-Worker.ps1',
  'scripts/Protect-ARIA-Persistent-Worker-Config.ps1',
  'scripts/aria-persistent-autonomy-v1.js',
  'scripts/aria-persistent-coordinator-v1.js',
  'scripts/aria-persistent-windows-worker-v1.js',
  'scripts/aria-persistent-windows-worker-preflight-v1.js',
  'scripts/aria-persistent-windows-worker-preflight-v1.test.js',
  'scripts/aria-persistent-windows-worker-preflight-v1.js',
  'scripts/aria-persistent-windows-worker-preflight-v1.test.js',
  'tests/cloudflare-autonomy-worker.test.js',
  'tests/pc-rwht-browser.test.js',
  'tests/pwa-capabilities-test-center-v1.test.js',
  'tests/aria-autonomy-supabase-boundary.test.js',
  'tests/ollama-persistent-adapter-v1.test.js',
  'tests/persistent-control-plane-v1.test.js',
  'tests/persistent-http-server-v1.test.js',
  'tests/persistent-hybrid-e2e-v1.test.js',
  'tests/persistent-notifications-v1.test.js',
  'tests/persistent-worker-bridge-v1.test.js',
  'tests/persistent-recovery-e2e-v1.test.js',
  'wrangler.aria-autonomy.toml'
];
for (const file of autonomyOnlyPaths) {
  assert.ok(legacyWorkflow.includes("- '" + file + "'") || (file.startsWith('cloudflare-autonomy/') && legacyWorkflow.includes("'cloudflare-autonomy/**'")), 'legacy production deploy must ignore ' + file);
}
assert.ok(legacyWorkflow.includes('SUPABASE_ACCESS_TOKEN'), 'legacy workflow remains explicitly identifiable as Supabase-coupled');
assert.match(pwaDeploy, /paths-ignore:/, 'production PWA deploy must have a safety path filter');
for (const file of autonomyOnlyPaths) {
  assert.ok(pwaDeploy.includes("- '" + file + "'") || (file.startsWith('cloudflare-autonomy/') && pwaDeploy.includes("'cloudflare-autonomy/**'")), 'production PWA deploy must ignore ' + file);
}
for (const file of autonomyOnlyPaths.filter(file => file.startsWith('autonomy/'))) {
  assert.ok(supabaseDeploy.includes("- '!" + file + "'"), 'Supabase runtime deploy must explicitly exclude ' + file);
}
assert.ok(
  supabaseDeploy.indexOf("      - 'autonomy/**'") < supabaseDeploy.indexOf("      - '!autonomy/PERSISTENT_AUTONOMY_V1.md'"),
  'Supabase path exclusions must follow the broad autonomy include'
);
assert.ok(
  supabaseDeploy.indexOf("      - '.github/workflows/supabase-canonical-deploy.yml'") < supabaseDeploy.indexOf("      - '!.github/workflows/supabase-canonical-deploy.yml'"),
  'Supabase workflow self-change must be excluded after its positive path'
);
assert.ok(supabaseDeploy.includes("- '!.github/workflows/supabase-canonical-deploy.yml'"), 'editing this safety workflow must not trigger a Supabase deployment');
assert.doesNotMatch(isolatedDeploy, /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF|supabase secrets set|supabase\.co/i);
assert.doesNotMatch(cloudWorker, /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF|createSupabaseMissionRepository|supabase\.co/i);
assert.match(wrangler, /class_name = "AriaMissionStore"/);
assert.match(wrangler, /new_sqlite_classes = \["AriaMissionStore"\]/);
assert.ok(windowsLauncher.includes("$launcherScript = Join-Path $installRoot 'scripts\\Start-ARIA-Persistent-Worker.ps1'"), 'scheduled task must point to the PowerShell supervisor');
assert.ok(windowsLauncher.includes('-File "\' + $launcherScript + \'"'), 'scheduled task must launch the supervisor script');
assert.ok(!windowsLauncher.includes('-File "\' + $workerScript + \'"'), 'scheduled task must not pass the JavaScript worker to PowerShell -File');
assert.ok(windowsLauncher.includes('[switch]$PreflightOnly'), 'supervisor must expose a one-shot preflight mode');
assert.ok(windowsLauncher.includes('& $NodePath $preflightScript'), 'preflight mode must invoke the read-only Node verifier');
assert.ok(windowsLauncher.includes('PreflightOnly and InstallScheduledTask cannot be used together.'), 'preflight must not be combined with task installation');
assert.ok(persistentWorkflow.includes('-File $supervisor') && persistentWorkflow.includes('-PreflightOnly'), 'RobVG physical job must run the actual PowerShell supervisor in preflight-only mode');
assert.ok(persistentWorkflow.includes('sparse-checkout:') && persistentWorkflow.includes('scripts/aria-persistent-windows-worker-preflight-v1.js'), 'physical supervisor preflight must receive only the required source files');
assert.doesNotMatch(persistentWorkflow, /& \$node \$supervisor/, 'PowerShell supervisor must never be passed to Node as a JavaScript entrypoint');
const absorbPrStart = absorbWorkflow.indexOf('\n  pull_request:');
const absorbPushStart = absorbWorkflow.indexOf('\n  push:', absorbPrStart);
const absorbDispatchStart = absorbWorkflow.indexOf('\n  workflow_dispatch:', absorbPushStart);
const absorbPrPaths = absorbWorkflow.slice(absorbPrStart, absorbPushStart);
const absorbPushPaths = absorbWorkflow.slice(absorbPushStart, absorbDispatchStart);
for (const file of ['.github/workflows/aria-cloudflare-deploy.yml', '.github/workflows/aria-pwa-fast-deploy.yml']) {
  assert.ok(absorbPrPaths.includes("- '" + file + "'"), 'ABSORB contract validation must continue to run for PR edits to ' + file);
  assert.ok(!absorbPushPaths.includes("- '" + file + "'"), 'ABSORB live E2E must not run on administrative edits to ' + file);
}
assert.ok(!absorbPushPaths.includes("- '.github/workflows/aria-absorb.yml'"), 'editing the ABSORB workflow itself must not trigger production LIVE E2E');
const absorbAutonomyDocsInclude = absorbPushPaths.indexOf("      - 'autonomy/**'");
const absorbMissionDocsExclude = absorbPushPaths.indexOf("      - '!autonomy/PERSISTENT_AUTONOMY_V1.md'");
assert.ok(absorbAutonomyDocsInclude >= 0 && absorbMissionDocsExclude > absorbAutonomyDocsInclude, 'updating the persistent autonomy guide must not trigger ABSORB production LIVE E2E');
process.stdout.write('aria-autonomy-supabase-boundary: all tests passed\n');
