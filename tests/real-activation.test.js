'use strict';

const assert = require('node:assert/strict');
const { DEFAULT_MANIFEST, activationSummary } = require('../activation/config');
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
  assert.equal(validateConnectorConfig({...DEFAULT_MANIFEST[0],base_url:'https://evil.example'}).reason, 'provider_origin_not_trusted');
  assert.equal(envNameForRef('secret://github/default'), 'ARIA_SECRET_GITHUB_DEFAULT');
  const resolver = createEnvironmentSecretResolver({ ARIA_SECRET_GITHUB_DEFAULT:'x' });
  const resolved = await resolver.resolve('secret://github/default');
  assert.equal(resolved.status, 'resolved');

  const safe = redact({ authorization:'Bearer confidential', nested:{ api_key:'secret-value', ok:'value', echo:'github-secret-123' } }, '', ['github-secret-123']);
  assert.equal(safe.authorization, '[redacted]');
  assert.equal(safe.nested.api_key, '[redacted]');
  assert.equal(safe.nested.ok, 'value');
  assert.equal(safe.nested.echo, '[redacted]');

  for (const id of ['github','supabase','cloudflare','notion','web','image','filesystem']) {
    assert.equal(typeof adapters[id].execute, 'function');
    assert.equal(typeof adapters[id].health, 'function');
    for (const operation of adapters[id].descriptor.operations) assert.ok(adapters[id].descriptor.operation_risk[operation], `${id}:${operation} risk declared`);
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

  const blockedRuntime = createActivationRuntime({ manifest, env:{...env}, fetchImpl:fakeFetch, authorize:async()=>({status:'pending'}) });
  await blockedRuntime.probe(manifest.find(x=>x.connector_id==='github'));
  const beforeBlocked = calls.length;
  const blocked = await blockedRuntime.execute('github','workflow_dispatch',{risk_class:'HIGH_RISK_WRITE',input:{}});
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'authorization_not_approved');
  assert.equal(calls.length, beforeBlocked);

  const runtime2 = createActivationRuntime({ manifest, env:{...env}, fetchImpl:fakeFetch, authorize:async()=>({status:'approved'}) });
  await runtime2.probe(manifest.find(x=>x.connector_id==='github'));
  const beforeApproved = calls.length;
  const workflow = await runtime2.execute('github','workflow_dispatch',{risk_class:'HIGH_RISK_WRITE',owner:'Robvg9',repo:'aria-worker',workflow_id:'ci.yml',ref:'main',inputs:{}});
  assert.equal(workflow.status, 'succeeded');
  assert.equal(calls.length, beforeApproved + 1);
  assert.match(calls.at(-1).url, /actions\/workflows\/ci\.yml\/dispatches$/);
  assert.equal(calls.at(-1).opts.method, 'POST');

  const downgrade = await runtime2.execute('github','workflow_dispatch',{risk_class:'READ',owner:'Robvg9',repo:'aria-worker',workflow_id:'ci.yml'});
  assert.equal(downgrade.status, 'blocked');
  assert.equal(downgrade.reason, 'risk_class_insufficient');

  const write = await runtime2.execute('github','file_write',{risk_class:'LOW_RISK_WRITE',owner:'Robvg9',repo:'aria-worker',path:'tmp.txt',message:'test',content:'hello',sha:'abc',branch:'test'});
  assert.equal(write.status, 'succeeded');
  assert.match(calls.at(-1).url, /\/contents\/tmp\.txt$/);
  const writeBody = JSON.parse(calls.at(-1).opts.body);
  assert.equal(writeBody.content, Buffer.from('hello').toString('base64'));

  const missing = createActivationRuntime({ manifest:DEFAULT_MANIFEST, env:{}, fetchImpl:fakeFetch, authorize:async()=>({status:'approved'}) });
  const p = await missing.probe(DEFAULT_MANIFEST[0]);
  assert.equal(p.state, 'disabled');
  const notHealthy = await missing.execute('github','repo_read',{risk_class:'READ',owner:'x',repo:'y'});
  assert.equal(notHealthy.status, 'blocked');
  assert.equal(notHealthy.reason, 'connector_disabled');

  console.log('REAL ACTIVATION TESTS PASS');
})();
