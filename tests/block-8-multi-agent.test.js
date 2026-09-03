'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAgentRegistry } = require('../agents/registry');
const { createScope, scopeAllows } = require('../agents/scope');
const { planDelegation } = require('../agents/delegation');
const { createAgentMessage, normalizeAgentResult } = require('../agents/message');
const { createAgentGuard } = require('../agents/guard');
const { runAgentDelegation } = require('../agents/coordinator');
const { verifyAgentResult, acceptVerifiedResult } = require('../agents/verification');
const { authorizeAgentAction, auditAgentEvent } = require('../agents/governance');
const { recoverAgent } = require('../agents/recovery');

(async () => {
  const registry = createAgentRegistry();
  registry.register({ id:'research', role:'researcher', capabilities:['research'], scope:['read'], max_risk:'medium', status:'available' });
  registry.register({ id:'blocked', role:'helper', capabilities:['research'], status:'blocked' });
  assert.equal(registry.available('research'), true);
  assert.equal(registry.get('research').max_risk, 'medium');
  assert.equal(registry.available('blocked'), false);

  const scope = createScope({ capabilities:['research'], tools:['web'], operations:['search'], max_risk:'medium' });
  assert.equal(scopeAllows(scope,{ capability:'research', tool:'web', operation:'search', risk:'low' }), true);
  assert.equal(scopeAllows(scope,{ capability:'research', tool:'web', operation:'search', risk:'high' }), false);

  const plan = planDelegation({ registry, from:'aria', agent_id:'research', task_id:'t1', objective:'find', request:{ capability:'research', tool:'web', operation:'search', risk:'low' } });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.depth, 1);
  assert.equal(planDelegation({ registry, agent_id:'blocked', task_id:'t2', objective:'x', request:{ risk:'low' } }).reason, 'agent_unavailable');
  assert.equal(planDelegation({ registry, agent_id:'research', task_id:'t3', objective:'x', request:{ risk:'low' }, parent_depth:2, max_depth:2 }).reason, 'max_depth');

  const msg = createAgentMessage({ message_id:'m1', task_id:'t1', from:'aria', to:'research', type:'task', payload:{x:1}, depth:1 });
  assert.equal(msg.version, 1);
  const result = normalizeAgentResult({ agent_id:'research', task_id:'t1', status:'succeeded', output:'ok', verified:true });
  assert.equal(verifyAgentResult(result).verified, true);
  assert.equal(acceptVerifiedResult(result), true);
  assert.equal(acceptVerifiedResult({ ...result, verified:false }), false);
  assert.equal(verifyAgentResult({ ...result, output:'api_key=LEAK' }).reason, 'sensitive_output');

  const guard = createAgentGuard({ max_depth:1, max_agents:1, max_steps:2 });
  assert.equal(guard.canSpawn(0), true); assert.equal(guard.spawned(), true); assert.equal(guard.canSpawn(0), false); guard.finished();

  const out = await runAgentDelegation({ registry, agent_id:'research', task_id:'t4', objective:'find', request:{ capability:'research', risk:'low' }, executeAgent: async () => ({ status:'succeeded', output:'done', verified:true, agent_id:'spoof', task_id:'spoof' }) });
  assert.equal(out.status, 'completed');
  assert.equal(out.result.verified, true);
  assert.equal(out.result.agent_id, 'research');
  assert.equal(out.result.task_id, 't4');

  assert.equal(authorizeAgentAction({ agent:registry.get('research'), request:{ risk:'low' } }).allowed, true);
  assert.equal(authorizeAgentAction({ agent:registry.get('research'), request:{ risk:'high' } }).reason, 'risk_exceeded');
  assert.equal(auditAgentEvent({ task_id:'t1', type:'status', state:'ok' }).valid, true);
  assert.equal(auditAgentEvent({ task_id:'t1', type:'status', token:'secret' }).valid, false);

  let attempts = 0;
  const recovered = await recoverAgent({ max_attempts:1, message:msg, execute: async () => { attempts += 1; if (attempts === 1) throw new Error('x'); return { ok:true }; } });
  assert.equal(recovered.status, 'recovered'); assert.equal(recovered.attempts, 2);
  const bounded = await recoverAgent({ max_attempts:2, message:msg, execute: async () => ({ok:true}) });
  assert.equal(bounded.status, 'blocked');

  for (const file of ['../agents/registry.js','../agents/scope.js','../agents/delegation.js','../agents/coordinator.js','../agents/message.js','../agents/guard.js','../agents/verification.js','../agents/governance.js','../agents/recovery.js']) {
    const text = fs.readFileSync(__dirname + '/' + file, 'utf8');
    assert.equal(/process\.env|authorization:|Bearer\s+/i.test(text), false);
  }
  assert.equal(msg.payload.x, 1);
  console.log('BLOCK 8 MULTI-AGENT TESTS PASS');
})();