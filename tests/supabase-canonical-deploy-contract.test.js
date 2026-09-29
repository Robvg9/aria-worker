'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync('.github/workflows/supabase-canonical-deploy.yml','utf8');
const pwaDeploy=fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml','utf8');
const workerPwa=fs.readFileSync('worker.js','utf8');

const releaseFunctions=['aria-planner-v11','aria-canonical-runtime-v1','aria-mission-runner-v22','aria-runtime-gateway-v1','aria-execution-runtime-v1','aria-device-gateway','aria-smart-verifier-v1','aria-direct-v1','aria-memory-v2'];
for(const fn of releaseFunctions) assert.match(source,new RegExp(`functions deploy ${fn}\\b`),`${fn} must be deployed`);

const protectedFunctions=['aria-planner-v11','aria-mission-runner-v22','aria-runtime-gateway-v1','aria-execution-runtime-v1','aria-device-gateway','aria-smart-verifier-v1'];
for(const fn of protectedFunctions) assert.ok(fs.existsSync(path.join('supabase','functions',fn,'index.ts')),`${fn} source index.ts must be versioned`);
assert.ok(fs.existsSync(path.join('supabase','functions','aria-runtime-gateway-v1','deno.json')),'aria-runtime-gateway-v1 deno.json must be versioned');

for(const fn of ['aria-planner-v10','aria-autonomy-supervisor-v10','aria-autonomy-supervisor-v5','aria-mission-runner-v15','aria-mission-runner-v16','aria-mission-runner-v17','aria-mission-runner-v18'])
  assert.doesNotMatch(source,new RegExp(`functions deploy ${fn}\\b`),`${fn} must remain compatibility-only`);
assert.doesNotMatch(source,/functions deploy aria-mission-runner-v14\\b/);
assert.doesNotMatch(source,/functions deploy aria-mcp-server-grok-v2\\b/);
assert.doesNotMatch(source,/functions deploy aria-mcp-oauth-grok-v2\\b/);
assert.match(source,/canonical execution chain is release-bearing/);
assert.ok(source.includes('supabase link --project-ref "$SUPABASE_PROJECT_REF"'));
assert.match(source,/supabase migration fetch --linked --yes/);
assert.match(source,/BASE_SHA="\$\(git rev-list --parents -n 1 "\$GITHUB_SHA" \| cut -d' ' -f2\)"/);
assert.match(source,/git diff --name-only "\$BASE_SHA" "\$GITHUB_SHA"/);
assert.doesNotMatch(source,/git diff-tree --no-commit-id --name-only -r "\$GITHUB_SHA"/);
assert.match(source,/supabase db push --include-all/);
assert.match(source,/remote_hashes/);
assert.match(source,/remote_versions/,'migration gate must track remote migration versions');
assert.match(source,/REMOTE_MAX_MIGRATION_VERSION=/,'migration gate must establish the remote migration watermark');
assert.match(source,/sort -n \| head -n1/,'migration watermark comparison must use stable numeric ordering');
assert.doesNotMatch(source,/\$version" <= "\$remote_max_version/,'invalid bash <= comparison must never be emitted');
assert.doesNotMatch(source,/\[\[ "\$version" < "\$remote_max_version" \]\] \|\|/,'fragile mixed bash string comparison must not be used');
assert.match(source,/HISTORICAL_LOCAL_DRIFT_IGNORED=/,'historical local migration drift must never be replayed');
assert.match(source,/HISTORICAL_MIGRATION_VERSION_CONTENT_DRIFT_IGNORED=/,'historical same-version SQL drift must be evidenced without replay');
assert.match(source,/MIGRATION_VERSION_CONTENT_DRIFT=/,'same-version content drift must be explicitly evidenced');
assert.ok(fs.existsSync(path.join('supabase','migrations','20260928213000_reconcile_duplicate_20260918013000_v1.sql')),'duplicate historical migration versions must be reconciled by a new canonical migration');
assert.ok(!fs.existsSync(path.join('supabase','migrations','20260918013000_meditation_verified_db_guard_v1.sql')),'historical duplicate migration must be outside canonical migration directory');
assert.ok(!fs.existsSync(path.join('supabase','migrations','20260918013000_mission_chain_evidence_v1.sql')),'historical duplicate migration must be outside canonical migration directory');
assert.doesNotMatch(source,/\\\\\$\\{remote_hashes\\[\\$hash\\]\\+x\\}/,'migration hash lookup must not escape the shell variable expansion');
assert.match(source,/MIGRATION_PENDING=/);
assert.match(source,/MIGRATION_ALREADY_APPLIED=/);
assert.match(source,/LEGACY_MIGRATION_IGNORED=/);
assert.match(source,/duplicate pending migration versions/);

assert.ok(workerPwa.includes('const PWA_BUILD = "__PWA_BUILD__";'));
assert.ok(workerPwa.includes('const isShell=shellPath==="/index-"+PWA_BUILD+".html"||shellPath==="/manifest.json"||shellPath==="/sw-"+PWA_BUILD+".js'));
assert.ok(workerPwa.includes('shellPath="/index-"+PWA_BUILD+".html"'));
assert.ok(workerPwa.includes('if(shellPath==="/manifest.json"||oldManifest)shellPath="/manifest.json";'));
assert.ok(workerPwa.includes('shellPath="/sw-"+PWA_BUILD+".js"'));
assert.ok(workerPwa.includes('responseHeaders.set("cache-control","no-store, max-age=0")'));
assert.ok(workerPwa.includes('...(isShell?{cache:"no-store"}:{})'));
assert.doesNotMatch(workerPwa,/cache:isShell\?"no-store":"default"/);

assert.ok(pwaDeploy.includes('cp dist/index.html "dist/index-${GITHUB_SHA}.html"'));
assert.ok(pwaDeploy.includes('cp dist/manifest.json "dist/manifest-${GITHUB_SHA}.json"'));
assert.ok(pwaDeploy.includes('sed "s/__BUILD__/${GITHUB_SHA}/g" public/sw.js > "dist/sw-${GITHUB_SHA}.js"'));
assert.ok(pwaDeploy.includes('grep -q "aria-pwa-${GITHUB_SHA}" "dist/sw-${GITHUB_SHA}.js"'));
assert.ok(pwaDeploy.includes('sed -i "s/__PWA_BUILD__/${GITHUB_SHA}/g" worker.js'));

const workflowDir='.github/workflows';
const workflowFiles=fs.readdirSync(workflowDir).filter(name=>name.endsWith('.yml')||name.endsWith('.yaml'));
const canonicalReleaseBearing=new Set(['supabase-canonical-deploy.yml']);
for(const file of workflowFiles){
  const text=fs.readFileSync(path.join(workflowDir,file),'utf8');
  if(!canonicalReleaseBearing.has(file)){
    for(const fn of protectedFunctions){
      assert.doesNotMatch(text,new RegExp(`supabase functions deploy ${fn}\\b`),`${file} must not directly deploy canonical runtime function ${fn}`);
    }
  }
  assert.doesNotMatch(text,/aria-planner-v12\\b/,'active workflows must not call retired planner-v12');
  assert.doesNotMatch(text,/aria-mission-runner-v15\\b|aria-mission-runner-v16\\b|aria-mission-runner-v17\\b|aria-mission-runner-v18\\b/,'active workflows must not call retired mission-runner versions');
  assert.doesNotMatch(text,/aria-autonomy-supervisor-v10\\b/,'active workflows must not call retired autonomy-supervisor-v10');
}
console.log('SUPABASE CANONICAL DEPLOY CONTRACT: PASS');