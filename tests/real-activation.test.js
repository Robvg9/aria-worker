'use strict';

const assert = require('node:assert/strict');
const { DEFAULT_MANIFEST, normalizeManifest, activationSummary } = require('../activation/config');
const { isSecretRef, validateConnectorConfig } = require('../activation/contract');
const { envNameForRef, createEnvironmentSecretResolver } = require('../activation/secrets');
const { createActivationRuntime } = require('../activation/runtime');
const { redact } = require('../activation/redaction');
const { adapters } = require('../activation/connectors');

(async () => {
  assert.equal(DEFAULT_MANIFEST.length, 7);
  assert.equal(isSecretRef('secret://github/default'), true);
  assert.equal(isSecretRef('plaintext'), false);
  assert.equal(validateConnectorConfig(DEFAULT_MANIFEST[0]).valid, true);
  assert.equal(envNameForRef('secret://github/default'), 'ARIA_SECRET_GITHUB_DEFAULT');
  const resolver = createEnvironmentSecretResolver({ ARIA_SECRET_GITHUB_DEFAULT:'x' });
  const resolved = await resolver.resolve('secret://github/default');
  assert.equal(resolved.status, 'resolved');

  const safe = redact({ authorization:'Bearer confidential', nested:{ api_key:'secret-value', ok:'value' } });
  assert.equal(safe.authorization, '[redacted]');
  assert.equal(safe.nested.api_key, '[redacted]');
  assert.equal(safe.nested.ok, 'value');

  for (const id of ['github','supabase','cloudflare','notion','web','image','filesystem']) {
    assert.equal(typeof adapters[id].execute, 'function');
    assert.equal(typeof adapters[id].health, 'function');
  }

  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok:true, status:200, text:async()=>JSON.stringify({ ok:true }) };
  };
  const env = {
    ARIA_SECRET_GITHUB_DEFAULT:'github-token',
    ARIA_SECRET_SUPABASE_DEFAULT:'supabase-token',
    ARIA_SECRET_CLOUDFLARE_DEFAULT:'cloudflare-token',
    ARIA_SECRET_NOTION_DEFAULT:'notion-token'
  };
  const manifest = DEFAULT_MANIFEST.map(x => ({ ...x, enabled: ['github','supabase','cloudflare','notion','web'].includes(x.connector_id) }));
  const runtime = createActivationRuntime({ manifest, env, fetchImpl:fakeFetch, authorize:async()=>({ status:'approved' }) });
  const summary = activationSummary(manifest);
  assert.equal(summary.length, 7);
  assert.equal(runtime.snapshot().find(x=>x.connector_id==='github').credential_configured, true);
  assert.equal(runtime.snapshot().find(x=>x.connector_id==='filesystem').credential_configured, true);

  const gh = await runtime.probe(manifest.find(x=>x.connector_id==='github'));
  assert.equal(gh.state, 'healthy');
  assert.match(calls[0].url, /api\.github\.com\/rate_limit$/);

  const supabase = await runtime.probe(manifest.find(x=>x.connector_id==='supabase'));
  assert.equal(supabase.state, 'healthy');
  assert.match(calls[1].url, /api\.supabase\.com\/v1\/projects$/);

  const cf = await runtime.probe(manifest.find(x=>x.connector_id==='cloudflare'));
  assert.equal(cf.state, 'healthy');
  assert.match(calls[2].url, /api\.cloudflare\.com\/client\/v4\/accounts\/$/);

  const notion = await runtime.probe(manifest.find(x=>x.connector_id==='notion'));
  assert.equal(notion.state, 'healthy');
  assert.match(calls[3].url, /api\.notion\.com\/v1\/users\/me$/);

  const blocked = await runtime.execute('github','workflow_dispatch',{risk_class:'HIGH_RISK_WRITE',input:{}});
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'authorization_not_approved');

  const runtime2 = createActivationRuntime({ manifest, env:{...env}, fetchImpl:fakeFetch, authorize:async()=>({status:'approved'}) });
  await runtime2.probe(manifest.find(x=>x.connector_id==='github'));
  const workflow = await runtime2.execute('github','workflow_dispatch',{risk_class:'HIGH_RISK_WRITE',owner:'Robvg9',repo:'aria-worker',workflow_id:'ci.yml',ref:'main',inputs:{}});
  assert.equal(workflow.status, 'succeeded');
  assert.match(calls.at(-1).url, /actions\/workflows\/ci\.yml\/dispatches$/);

  const missing = createActivationRuntime({ manifest:DEFAULT_MANIFEST, env:{}, fetchImpl:fakeFetch, authorize:async()=>({status:'approved'}) });
  const p = await missing.probe(DEFAULT_MANIFEST[0]);
  assert.equal(p.state, 'unconfigured');
  const notHealthy = await missing.execute('github','repo_read',{risk_class:'READ',owner:'x',repo:'y'});
  assert.equal(notHealthy.status, 'blocked');

  console.log('REAL ACTIVATION TESTS PASS');
})();
