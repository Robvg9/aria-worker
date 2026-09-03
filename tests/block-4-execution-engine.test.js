'use strict';
const assert = require('node:assert/strict');
const { topologicalOrder } = require('../execution-engine/dependencies');
const { createExecutionMonitor } = require('../execution-engine/monitor');
const { createExecutionCoordinator } = require('../execution-engine/coordinator');
const { verifyStep, verifyTask } = require('../execution-engine/verifier');
const { rollback } = require('../execution-engine/rollback');
const { createLongRunningStore } = require('../execution-engine/long-running');
const { recoverStep } = require('../execution-engine/recovery');

assert.deepEqual(topologicalOrder([{id:'b',depends_on:['a']},{id:'a',depends_on:[]}]), ['a','b']);
assert.throws(() => topologicalOrder([{id:'a',depends_on:['b']},{id:'b',depends_on:['a']}]), /dependency_cycle/);

(async () => {
  const events = [];
  const monitor = createExecutionMonitor({ onEvent: (e) => events.push(e) });
  const coordinator = createExecutionCoordinator({
    monitor,
    executeStep: async (step) => ({ status:'succeeded', step:step.id }),
    checkpointStore: { checkpoint: async () => ({status:'checkpointed'}) }
  });
  const result = await coordinator.run({ task_id:'task_4', steps:[{id:'a',depends_on:[]},{id:'b',depends_on:['a']}], verify: async (results) => results.length === 2 });
  assert.equal(result.status,'completed');
  assert.equal(result.verification.verified,true);
  assert.equal(events.some(e => e.type === 'task.state' && e.state === 'completed'), true);

  const failureMonitor = createExecutionMonitor();
  const compensated = [];
  const failureCoordinator = createExecutionCoordinator({ monitor:failureMonitor, executeStep: async (step) => step.id === 'b' ? {status:'failed',error:{code:'provider_error'}} : {status:'succeeded'}, });
  const failed = await failureCoordinator.run({ task_id:'task_fail', steps:[{id:'a',depends_on:[]},{id:'b',depends_on:['a']}], compensators:{ a: async () => { compensated.push('a'); return {status:'succeeded'}; } } });
  assert.equal(failed.status,'failed');
  assert.deepEqual(compensated,['a']);

  const retry = await recoverStep({ step:{id:'x'}, error:{code:'temporary'}, retry:true, maxRetries:1, retryCount:0, execute:async () => ({status:'succeeded'}) });
  assert.equal(retry.status,'recovered');
  assert.equal(verifyStep({status:'succeeded'}).verified,true);
  assert.equal((await verifyStep({status:'succeeded'},{verify:() => false})).verified,false);
  assert.equal((await verifyTask([{status:'succeeded'}])).verified,true);
  assert.equal((await verifyTask([{status:'failed'}])).verified,false);
  assert.equal((await rollback([{id:'a',result:{status:'succeeded'}}],{a:async()=>({status:'succeeded'})})).status,'rolled_back');
  assert.equal((await rollback([{id:'a',result:{status:'succeeded'}}],{})).status,'partial');

  const saved = new Map();
  const store = createLongRunningStore({ save: async task => saved.set(task.task_id, task), load: async id => saved.get(id) });
  await store.checkpoint({task_id:'long_1',state:'waiting'});
  assert.deepEqual(await store.resume('long_1'), {task_id:'long_1',state:'waiting'});

  console.log('BLOCK 4/9 PASS: coordinator, dependency resolution, monitoring, recovery, verification, rollback, and resumable execution');
})().catch(err => { console.error(err); process.exit(1); });
