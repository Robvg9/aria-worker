'use strict';

const assert = require('node:assert/strict');
const { createToolRegistry } = require('../tool-universe/registry');
const { createConnectorManager } = require('../tool-universe/connector-manager');
const { createCredentialManager } = require('../tool-universe/credential-manager');
const { createToolDiscovery } = require('../tool-universe/discovery');
const { createPermissionResolver } = require('../tool-universe/permission-resolver');
const { createMultiToolExecutor } = require('../tool-universe/multi-tool');
const { createToolRecovery } = require('../tool-universe/recovery');

const READ = { tool_id:'tool_a', name:'A', provider_id:'test', interface_type:'internal', operations:['read'], risk_level:'read', status:'available', permission_refs:[], mcp_tool_name:null, description:'read tool', metadata:{} };
const WRITE = { tool_id:'tool_b', name:'B', provider_id:'test', interface_type:'mcp', operations:['write'], risk_level:'high_risk_write', status:'unknown', permission_refs:[], mcp_tool_name:'b', description:'write tool', metadata:{} };
const registry = createToolRegistry([READ, WRITE]);
assert.equal(registry.list().length, 2, 'registry stores tools');
assert.throws(() => registry.register({ ...READ }), /tool_exists/);
assert.equal(registry.get('missing'), null);
registry.updateStatus('tool_b','available');
assert.equal(registry.get('tool_b').status,'available');

(async () => {
  const manager = createConnectorManager({ registry, probes: { default: async () => ({status:'available', detail:'ok'}) } });
  assert.equal((await manager.inspect('tool_a')).probe.status,'available');
  assert.equal((await manager.syncStatus('tool_b')).status,'available');

  const credentials = createCredentialManager({ resolver: async (ref) => ref === 'secret://test/key' ? 'secret-value' : null });
  assert.equal(await credentials.resolve('secret://test/key'),'secret-value');
  await assert.rejects(() => credentials.resolve('raw-secret'), /invalid_credential_ref/);

  const discovery = createToolDiscovery({ registry });
  assert.equal(discovery.discover({operation:'read'}).length, 1);
  assert.equal(discovery.discover({operation:'write'}).length, 1);

  const permission = createPermissionResolver({ approvalStore: { getApproval: async () => ({status:'approved'}) } });
  assert.equal((await permission.resolve({tool:READ, operation:'read', requestedRisk:'read', requestId:'r1', executionId:'e1'})).status,'approved');
  assert.equal((await permission.resolve({tool:WRITE, operation:'write', requestedRisk:'high_risk_write', requestId:'r1', executionId:'e1'})).status,'approved');
  const noApproval = createPermissionResolver();
  assert.equal((await noApproval.resolve({tool:WRITE, operation:'write', requestedRisk:'high_risk_write'})).status,'blocked');

  const router = { route: async ({tool_id,operation}) => tool_id && operation ? {status:'selected',tool_id,operation} : {status:'no_route'} };
  const gateway = { execute: async ({route}) => ({status:'succeeded',tool_id:route.tool_id}) };
  const multi = createMultiToolExecutor({router,gateway});
  const multiResult = await multi.execute({steps:[{id:'s1',tool_id:'tool_a',operation:'read',depends_on:[]},{id:'s2',tool_id:'tool_a',operation:'read',depends_on:['s1']}]});
  assert.equal(multiResult.status,'succeeded');
  assert.equal(multiResult.results.length,2);

  const recovery = createToolRecovery({ discover: async () => [{tool_id:'tool_a'},{tool_id:'tool_b'}], execute: async (t) => t.tool_id === 'tool_b' ? {status:'succeeded'} : {status:'failed'} });
  const recovered = await recovery.recover({reason:'provider_error'});
  assert.equal(recovered.status,'recovered');
  assert.equal(recovered.tool_id,'tool_b');
  assert.equal((await recovery.recover({reason:'authorization_denied'})).status,'no_recovery');

  console.log('BLOCK 2 TOOL UNIVERSE: PASS — 20 assertions');
})().catch((err) => { console.error(err); process.exit(1); });
