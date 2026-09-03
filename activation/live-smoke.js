'use strict';

const { createActivationRuntime } = require('./runtime');

async function main() {
  const runtime = createActivationRuntime();
  const before = runtime.snapshot();
  console.log(JSON.stringify({ phase:'live-smoke', credentials:before.map(x=>({connector_id:x.connector_id,configured:x.credential_configured,enabled:x.enabled})) }, null, 2));
  const results = await runtime.probeAll();
  console.log(JSON.stringify(results, null, 2));
  const requiredFailures = runtime.manifest
    .filter(x => x.required)
    .map(x => results.find(r => r.connector_id === x.connector_id))
    .filter(r => !r || r.state !== 'healthy');
  if (requiredFailures.length) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error('live_smoke_failed'); process.exitCode = 1; });
module.exports = { main };
