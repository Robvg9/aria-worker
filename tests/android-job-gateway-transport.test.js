'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'supabase', 'functions', 'aria-device-gateway', 'index.ts');
const source = fs.readFileSync(file, 'utf8');

const pausedSet = source.match(/const PAUSED_MISSION_ENDPOINTS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(pausedSet, 'global mission pause set must be defined');
for (const endpoint of ["/v1/jobs/claim", "/v1/voice/commands/claim"]) {
  assert.ok(pausedSet[1].includes(JSON.stringify(endpoint)), `global execution pause must block ${endpoint}`);
}
assert.ok(
  source.includes('if(MISSION_EXECUTION_PAUSED&&(PAUSED_MISSION_ENDPOINTS.has(p)'),
  'pause guard must run before device routes'
);

// The gateway deliberately invokes public SECURITY DEFINER SQL functions over
// its bounded Postgres transport. Do not assert supabase.rpc(): the restricted
// aria_internal schema is not exposed through PostgREST and this implementation
// uses the direct SQL connection with parameterized tagged-template arguments.
const helperStart = source.indexOf('async function executionJobGatewayCall(kind:string,args:any){');
const helperEnd = source.indexOf('\n}', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'single execution-job gateway helper must exist');
const helper = source.slice(helperStart, helperEnd + 2);
assert.ok(helper.includes("const dbUrl=Deno.env.get('SUPABASE_DB_URL')||'';"), 'gateway must use the configured database URL');
assert.ok(helper.includes('const sql=postgres(dbUrl,{max:1,idle_timeout:5,connect_timeout:8});'), 'gateway SQL client must remain bounded');
assert.match(helper, /sql\`select public\.claim_execution_job_gateway\(\$\{String\(args\.deviceId\)\}\) as data\`/);
assert.match(helper, /sql`select public\.start_execution_job_gateway\(\$\{String\(args\.jobId\)\},\$\{String\(args\.deviceId\)\},\$\{typeof args\.leaseOwner==='string'\?args\.leaseOwner:null\}\) as data`/);
assert.ok(helper.includes('public.complete_execution_job_gateway('), 'completion must use the canonical SQL function');
assert.ok(helper.includes('${JSON.stringify(args.result||{})}::text::jsonb'), 'completion JSON must remain parameterized');
assert.equal(helper.split("${typeof args.leaseOwner==='string'?args.leaseOwner:null}").length - 1, 2, 'start and complete must parameterize the optional lease owner');
assert.ok(helper.includes('await sql.end({timeout:3})'), 'database client must be closed in finally');
assert.ok(helper.includes("throw new Error('device_gateway_db_unavailable')"), 'gateway must fail closed when DB URL is missing');
assert.ok(!helper.includes('.unsafe('), 'gateway must not use unsafe raw SQL');

const jobsStart = source.indexOf("const s=p.match(/^\\/v1\\/jobs\\/([^/]+)\\/start$/)");
const jobsResult = source.indexOf("const z=p.match(/^\\/v1\\/jobs\\/([^/]+)\\/result$/)");
assert.ok(jobsStart > 0 && jobsResult > jobsStart, 'job start/result routes must be present in order');
assert.ok(source.includes("executionJobGatewayCall('claim',{deviceId:d.device_id})"), 'claim route must use the single helper');
assert.ok(source.includes("executionJobGatewayCall('start',{jobId,deviceId:d.device_id,leaseOwner:typeof b.lease_owner==='string'?b.lease_owner:null})"), 'start route must pass the optional lease owner');
assert.ok(source.includes("executionJobGatewayCall('complete',{jobId,deviceId:d.device_id,status,exitCode,stdout:clean.stdout,stderr:clean.stderr,result:clean,leaseOwner:typeof b.lease_owner==='string'?b.lease_owner:null})"), 'completion route must pass the optional lease owner');

const criticalPath = source.slice(
  source.indexOf("if(req.method==='POST'&&p==='/v1/jobs/claim')"),
  source.lastIndexOf("return json({error:'not_found'},404)")
);
assert.ok(!criticalPath.includes("transport:'postgres'"), 'critical job path must not report raw postgres transport');
assert.ok(!criticalPath.includes("transport:'postgrest-fallback'"), 'critical job path must not use transport fallback branching');
assert.ok(criticalPath.includes("transport:'supabase-rpc'"), 'critical job path must identify the public SQL RPC contract');

const swipeMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260923170000_add_swipe_action_to_android_job_gateway.sql'),
  'utf8'
);
assert.match(swipeMigration, /'swipe'/, 'swipe action must be allowed by the canonical Android job validator');
assert.match(swipeMigration, /'x1'.*'y1'.*'x2'.*'y2'.*'durationMs'/s, 'swipe coordinates/duration must be validated');
assert.match(swipeMigration, /swipe distance too small/, 'swipe must reject zero-distance gestures');

console.log('PASS android job gateway transport contract');
