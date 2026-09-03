'use strict';
const assert = require('node:assert/strict');
const { listConnectors, getConnector, CONNECTORS } = require('../connectors/registry');
const { createConnectorAdapters, SPECS } = require('../connectors/adapters');
const { createConnectorRuntime } = require('../connectors/runtime');

assert.equal(CONNECTORS.length, 7, '3.1–3.7 all connectors registered');
for (const c of listConnectors()) {
  assert.equal(c.status, 'planned', `${c.connector_id} remains unconnected until configured`);
  assert.ok(Array.isArray(c.operations) && c.operations.length > 0, `${c.connector_id} declares operations`);
  assert.equal(JSON.stringify(c).includes('bearer'), false, `${c.connector_id} registry has no secret material`);
}
assert.equal(getConnector('github').name, 'GitHub', '3.1 GitHub');
assert.equal(getConnector('supabase').name, 'Supabase', '3.2 Supabase');
assert.equal(getConnector('cloudflare').name, 'Cloudflare', '3.3 Cloudflare');
assert.equal(getConnector('notion').name, 'Notion / ChatBending', '3.4 Notion');
assert.equal(getConnector('web').name, 'Web Research', '3.5 Web');
assert.equal(getConnector('filesystem').name, 'Workspace Filesystem', '3.6 filesystem');
assert.equal(getConnector('image').name, 'Image Generation', '3.7 image');

(async () => {
  const calls = [];
  const adapters = createConnectorAdapters({ transports: Object.fromEntries(Object.keys(SPECS).map((id) => [id, async (req) => { calls.push(req); return { status: 'succeeded', connector_id: req.connector_id, operation: req.operation }; }])) });
  const runtime = createConnectorRuntime({ adapters, probes: Object.fromEntries(Object.keys(SPECS).map((id) => [id, async () => ({ status: 'available' })])) });

  for (const id of Object.keys(SPECS)) {
    const info = await runtime.inspect(id);
    assert.equal(info.adapter_present, true, `${id} adapter present`);
    assert.equal(info.availability, 'available', `${id} health available`);
    const op = SPECS[id][0];
    const result = await adapters[id].execute({ operation: op, credential_ref: 'secret://test/ref', input: { smoke: true } });
    assert.equal(result.status, 'succeeded', `${id} transport boundary works`);
  }
  assert.equal(calls.length, 7, 'exactly one injected call per connector');
  assert.equal((await adapters.github.execute({ operation: 'not_supported', credential_ref: 'secret://test/ref' })).status, 'blocked');
  assert.equal((await adapters.github.execute({ operation: 'repo_read' })).status, 'blocked');
  console.log('BLOCK 3 REAL CONNECTORS: PASS — connector registry, adapter boundaries, runtime health, and credential contract verified');
})().catch((err) => { console.error(err); process.exit(1); });
