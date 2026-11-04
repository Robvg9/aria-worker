'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const source = read('.github/workflows/mission-wonder-2-step3-a3-live.yml');
const presenceScript = read('.github/scripts/mission-wonder-2-step3-a3-live-presence.ps1');
const deployScript = read('.github/scripts/mission-wonder-2-step3-a3-deploy-coordinator.sh');
const secretPrepScript = read('.github/scripts/mission-wonder-2-step3-a3-prepare-deploy-secrets.py');
const contract = read('.github/workflows/mission-wonder-2-step3-a3-contract.yml');
const pwa = read('.github/workflows/aria-pwa-fast-deploy.yml');
const legacyDeploy = read('.github/workflows/aria-cloudflare-deploy.yml');
const ignoreStart = pwa.indexOf('    paths-ignore:');
const ignoreEnd = pwa.indexOf('  workflow_dispatch:', ignoreStart);
const pwaIgnore = ignoreStart >= 0 && ignoreEnd > ignoreStart ? pwa.slice(ignoreStart, ignoreEnd) : '';

const a3OnlyPaths = [
  '.github/workflows/mission-wonder-2-step3-a3-contract.yml',
  '.github/workflows/mission-wonder-2-step3-a3-live.yml',
  '.github/scripts/mission-wonder-2-step3-a3-live-presence.ps1',
  '.github/scripts/mission-wonder-2-step3-a3-deploy-coordinator.sh',
  '.github/scripts/mission-wonder-2-step3-a3-prepare-deploy-secrets.py',
  'autonomy/worker-single-instance-lock-v1.js',
  'tests/mission-wonder-2-step3-a3-presence.test.mjs',
  'tests/mission-wonder-2-step3-a3-live-workflow-contract.test.cjs',
  'tests/worker-single-instance-lock-v1.test.js'
];
for (const p of a3OnlyPaths) assert.ok(pwaIgnore.includes(`      - '${p}'`), `PWA Fast Lane must ignore A3-only path: ${p}`);

const legacyIgnoreStart = legacyDeploy.indexOf('    paths-ignore:');
const legacyIgnoreEnd = legacyDeploy.indexOf('  workflow_dispatch:', legacyIgnoreStart);
const legacyIgnore = legacyIgnoreStart >= 0 && legacyIgnoreEnd > legacyIgnoreStart
  ? legacyDeploy.slice(legacyIgnoreStart, legacyIgnoreEnd)
  : '';
for (const p of [
  '.github/scripts/mission-wonder-2-step3-a3-live-presence.ps1',
  '.github/scripts/mission-wonder-2-step3-a3-deploy-coordinator.sh',
  '.github/scripts/mission-wonder-2-step3-a3-prepare-deploy-secrets.py'
]) {
  assert.ok(legacyIgnore.includes(`      - '${p}'`), `Legacy ARIA production deploy must ignore A3-only helper: ${p}`);
}

function triggerSection(trigger) {
  const start = contract.indexOf(`  ${trigger}:\n`);
  const end = trigger === 'pull_request' ? contract.indexOf('\n  push:', start) : contract.indexOf('\npermissions:', start);
  assert.ok(start >= 0 && end > start, `A3 contract trigger section exists: ${trigger}`);
  return contract.slice(start, end);
}
for (const trigger of ['pull_request', 'push']) {
  const section = triggerSection(trigger);
  for (const p of [
    '.github/scripts/mission-wonder-2-step3-a3-live-presence.ps1',
    '.github/scripts/mission-wonder-2-step3-a3-deploy-coordinator.sh',
    '.github/scripts/mission-wonder-2-step3-a3-prepare-deploy-secrets.py'
  ]) assert.ok(section.includes(`      - '${p}'`), `A3 contract must test helper changes on ${trigger}: ${p}`);
}
assert.ok(triggerSection('push').includes("      - 'tests/mission-wonder-2-step3-a3-live-workflow-contract.test.cjs'"));

assert.match(source, /^name: A3 LIVE Presence-Only Pilot$/m);
assert.match(source, /^on:\s*\n  workflow_dispatch:/m, 'A3 must remain manual-only');
assert.doesNotMatch(source, /^  (push|pull_request):/m);
assert.match(source, /confirm_live_presence_only_pilot:[\s\S]{0,300}default: false/m);
assert.match(source, /approve_coordinator_production:[\\s\\S]{0,240}default: false/m);
assert.match(source, /approve_robvg_presence_recovery:[\\s\\S]{0,260}default: false/m);
assert.match(source, /deploy-coordinator:[\\s\\S]{0,180}approve_coordinator_production/m);
assert.match(source, /robvg-presence-recovery:[\\s\\S]{0,260}approve_robvg_presence_recovery/m);
assert.ok(source.includes('A3_PRESENCE_SCRIPT_RESTORE_FROM_OBJECT='));
assert.ok(source.includes('A3_PRESENCE_SCRIPT_WORKTREE_VERIFIED=PASS'));
assert.ok(source.indexOf('Verify and restore extracted A3 presence script') < source.indexOf('Run one bounded presence-only worker recovery pilot on ROBVG'));
assert.match(source, /environment: production/m);
assert.match(source, /robvg-presence-recovery:[\s\S]{0,220}environment: production/m);
assert.match(presenceScript, /RUNNER_NAME -ne 'ARIA-WINDOWS'[\s\S]{0,100}COMPUTERNAME -ne 'ROBVG'/m);
assert.ok(source.includes('        shell: powershell -NoProfile -ExecutionPolicy Bypass -File {0}'));
assert.match(source, /run: bash \.github\/scripts\/mission-wonder-2-step3-a3-deploy-coordinator\.sh/);
assert.ok(source.includes("Join-Path $env:GITHUB_WORKSPACE '.github\\scripts\\mission-wonder-2-step3-a3-live-presence.ps1'"));
assert.ok(source.split(/\r?\n/).length < 180, 'compact YAML keeps workflow trigger metadata indexable');

assert.ok(presenceScript.split(/\r?\n/).length < 330, 'presence script must not contain duplicated or truncated trailing code');
assert.match(presenceScript, /function Write-A3SafeProcessDiagnostics/);
assert.match(presenceScript, /\$runtimeModules = @\([\s\S]{0,220}autonomy\/persistent-worker-error-policy-v1\.js[\s\S]{0,180}autonomy\/worker-single-instance-lock-v1\.js/m);
assert.match(presenceScript, /A3_WORKSPACE_COMMIT_MISMATCH/);
assert.match(presenceScript, /rev-parse "HEAD:\$relativePath"/);
assert.match(presenceScript, /ls-files --stage -- \$relativePath/);
assert.match(presenceScript, /cat-file','blob',blobSha/);
assert.match(presenceScript, /writeFileSync\(target,content\)/);
assert.match(presenceScript, /hash-object',target/);
assert.match(presenceScript, /A3_RUNTIME_MODULE_RESTORE_FROM_OBJECT=/);
assert.match(presenceScript, /require\.resolve\(name\)/);
assert.match(presenceScript, /A3_RUNTIME_DEPENDENCY_PREFLIGHT=PASS/);
assert.match(presenceScript, /A3_NODE_VERSION=/);
assert.match(presenceScript, /ReadAllText\(\$entry\.Path, \[System\.Text\.Encoding\]::UTF8\)/);
assert.match(presenceScript, /\$raw = \$raw\.Replace\(\[string\]\$secret, '\[REDACTED\]'\)/);
assert.match(presenceScript, /Write-A3SafeProcessDiagnostics -Label 'first-worker-exited-early'/);
assert.match(presenceScript, /Write-A3SafeProcessDiagnostics -Label 'first-worker-heartbeat-timeout'/);
assert.match(presenceScript, /Write-A3SafeProcessDiagnostics -Label 'recovery-worker-exit-nonzero'/);
assert.match(deployScript, /wrangler deploy --config wrangler\.aria-autonomy\.toml/);
assert.match(secretPrepScript, /ARIA_PLAN_PRODUCER_TOKEN/);

assert.doesNotMatch(presenceScript + deployScript + secretPrepScript, /ARIA_RUNTIME_SHARED_SECRET|supabase db|supabase migration|supabase functions deploy/i);
assert.doesNotMatch(presenceScript, /Enable-ScheduledTask|Start-ScheduledTask|Register-ScheduledTask|Set-ScheduledTask/);
assert.match(presenceScript, /ttl_ms = 180000/);
assert.match(presenceScript, /CLOSE_MISSION_WONDER_2_A3_PRESENCE_ONLY/);
assert.match(presenceScript, /ARIA_MW2_A3_PRESENCE_SCOPE_TOKEN/);
assert.match(presenceScript, /Stop-Process -Id \$workerOne\.Id -Force/);
assert.match(presenceScript, /A3_STALE_HEARTBEAT_DETECTION=PASS/);
assert.match(presenceScript, /A3_ZERO_ORPHAN_WORKER_PROCESSES=PASS/);
process.stdout.write('MISSION_WONDER_2_A3_LIVE_WORKFLOW_GUARDS=PASS\\n');
