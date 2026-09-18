const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();

const gateway=fs.readFileSync(path.join(root,'supabase/functions/aria-device-gateway/index.ts'),'utf8');
const supervisorSource=fs.readFileSync(path.join(root,'supabase/functions/aria-autonomy-supervisor-v5/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20260918190000_all_for_one_council_v1.sql'),'utf8');
const securityMigration=fs.readFileSync(path.join(root,'supabase/migrations/20260918190100_all_for_one_security_snapshot.sql'),'utf8');

assert.match(gateway,/\/v1\/audit\/all-for-one\/start/);
assert.match(gateway,/\/v1\/audit\/all-for-one\/tick/);
assert.match(gateway,/all_for_one_runs/);
assert.match(gateway,/all_for_one_auditors/);
assert.match(gateway,/aria-agent-runtime-v1/);
assert.match(gateway,/aria-execution-runtime-v1/);
assert.match(gateway,/all-for-one-v1/);
assert.match(gateway,/evidence-first; root-cause over patch/);
assert.match(gateway,/every eligible agent\/model attempted/);

assert.match(supervisorSource,/\/v1\/audit\/all-for-one\/tick/);
assert.match(supervisorSource,/all-for-one-supervisor-v1/);

assert.match(migration,/all_for_one_runs/);
assert.match(migration,/all_for_one_auditors/);
assert.match(migration,/all_for_one_reviews/);
assert.match(securityMigration,/get_all_for_one_security_snapshot/);
assert.match(migration,/revoke all on aria_internal\.all_for_one_runs from anon, authenticated/i);

console.log('ALL FOR ONE COUNCIL CONTRACT: PASS');
const v2Workflow=fs.readFileSync(path.join(root,'.github/workflows/aria-app-api-v2-deploy.yml'),'utf8');
assert.doesNotMatch(v2Workflow,/--verify-jwt/);
assert.match(v2Workflow,/supabase functions deploy aria-app-api-v2/);
assert.equal(fs.existsSync(path.join(root,'.github/workflows/restore-inbound-issuer.yml')),false);

const supervisor=fs.readFileSync(path.join(root,'supabase/functions/aria-autonomy-supervisor-v5/index.ts'),'utf8');
const gateway2=fs.readFileSync(path.join(root,'supabase/functions/aria-device-gateway/index.ts'),'utf8');
assert.match(supervisorSource,/\/v1\/audit\/all-for-one\/start/);
assert.match(supervisor,/\/v1\/audit\/all-for-one\/tick/);
assert.match(gateway2,/\.from\('all_for_one_runs'\)/);
