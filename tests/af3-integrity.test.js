'use strict';
const assert = require('assert');
const fs = require('fs');

const contract = fs.readFileSync('execution/device-contract.md', 'utf8');
const agent = fs.readFileSync('agents/termux/aria-agent.js', 'utf8');
const gateway = fs.readFileSync('supabase/functions/aria-device-gateway/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/aria_device_execution_v1.sql', 'utf8');

for (const marker of ['Job', 'Result', 'Device authentication', 'Human-Gate']) assert.ok(contract.includes(marker), `missing contract marker: ${marker}`);
for (const marker of ['ARIA_DEVICE_GATEWAY_URL', 'ARIA_DEVICE_TOKEN', 'ARIA_DEVICE_ID', '/v1/jobs/claim', '/result', 'MAX_OUTPUT']) assert.ok(agent.includes(marker), `missing agent marker: ${marker}`);
assert.ok(!agent.includes('SUPABASE_SERVICE_ROLE_KEY'));
for (const marker of ['SUPABASE_SERVICE_ROLE_KEY', 'device_registry', 'claim_execution_job', '/v1/devices/heartbeat', '/v1/jobs/claim', 'tokenHash']) assert.ok(gateway.includes(marker), `missing gateway marker: ${marker}`);
for (const marker of ['device_registry', 'execution_jobs', 'execution_job_events', 'claim_execution_job', 'ROW LEVEL SECURITY']) assert.ok(migration.includes(marker), `missing migration marker: ${marker}`);

console.log('af3-integrity.test.js: PASS');
