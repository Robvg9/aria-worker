'use strict';

const { DEFAULT_MANIFEST } = require('./config');
const { createActivationRuntime } = require('./runtime');

function liveManifest(env = process.env) {
  return DEFAULT_MANIFEST.map(entry => {
    if (!entry.credential_ref) return { ...entry };
    const key = `ARIA_SECRET_${entry.connector_id.toUpperCase()}_DEFAULT`;
    return { ...entry, enabled: Boolean(env && env[key]) };
  });
}

async function main({ env=process.env, fetchImpl=globalThis.fetch } = {}) {
  const manifest = liveManifest(env);
  const runtime = createActivationRuntime({ manifest, env, fetchImpl });
  const before = runtime.snapshot();
  console.log(JSON.stringify({ phase:'live-smoke', credentials:before.map(x=>({connector_id:x.connector_id,configured:x.credential_configured,enabled:x.enabled})) }, null, 2));
  const results = await runtime.probeAll();
  console.log(JSON.stringify(results, null, 2));
  const requiredFailures = runtime.manifest
    .filter(x => x.required)
    .map(x => results.find(r => r.connector_id === x.connector_id))
    .filter(r => !r || r.state !== 'healthy');
  if (requiredFailures.length) process.exitCode = 2;
  return { manifest, results };
}

if (require.main === module) main().catch(() => { console.error('live_smoke_failed'); process.exitCode = 1; });
module.exports = { main, liveManifest };
