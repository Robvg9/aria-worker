const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'supabase', 'functions', 'aria-device-gateway', 'index.ts');
const source = fs.readFileSync(file, 'utf8');

assert.match(source, /async function executionJobGatewayCall\(kind:string,args:any\)/);
assert.match(source, /supabase\.rpc\('claim_execution_job_gateway'/);
assert.match(source, /supabase\.rpc\('start_execution_job_gateway'/);
assert.match(source, /supabase\.rpc\('complete_execution_job_gateway'/);

const jobsStart = source.indexOf("const s=p.match(/^\\/v1\\/jobs\\/([^/]+)\\/start$/)");
const jobsResult = source.indexOf("const z=p.match(/^\\/v1\\/jobs\\/([^/]+)\\/result$/)");
assert.ok(jobsStart > 0 && jobsResult > jobsStart, 'job routes must be present in order');

const criticalPath = source.slice(source.indexOf("if(req.method==='POST'&&p==='/v1/jobs/claim')"), source.lastIndexOf("return json({error:'not_found'},404)"));
assert.ok(!criticalPath.includes("transport:'postgres'"), 'critical job path must not report raw postgres transport');
assert.ok(!criticalPath.includes("transport:'postgrest-fallback'"), 'critical job path must not use transport fallback branching');
assert.ok(criticalPath.includes("transport:'supabase-rpc'"), 'critical job path must identify the single RPC transport');

console.log('PASS android job gateway transport contract');
