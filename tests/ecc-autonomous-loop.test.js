'use strict';

const assert = require('node:assert/strict');
const { startLoop, tickLoop } = require('../scripts/ecc-autonomous-loop');

const graph = {
  schema: 'aria.ecc-mission-graph.v1',
  execution_state: 'DISABLED',
  graph_digest_sha256: 'graph',
  nodes: [
    { id: 'context', type: 'CONTEXT' },
    { id: 'load', type: 'LOAD_CAPABILITY' },
    { id: 'verify', type: 'VERIFY' },
  ],
  edges: [
    { from: 'context', to: 'load' },
    { from: 'load', to: 'verify' },
  ],
};

const loop = startLoop(graph, { max_retries: 2, max_ticks: 5 });
assert.equal(loop.schema, 'aria.ecc-autonomous-loop.v1');
assert.equal(loop.state, 'READY');
assert.equal(loop.current_node, 'context');
assert.equal(loop.activation_state, 'DISABLED');
assert.equal(loop.permission_grants, 0);

let running = tickLoop(loop, graph, { node_status: { context: 'COMPLETED' } });
assert.equal(running.current_node, 'load');
assert.equal(running.state, 'RUNNING');

const retry1 = tickLoop(running, graph, { error: 'timeout' });
assert.equal(retry1.state, 'RUNNING');
assert.equal(retry1.retries.load, 1);

const retry2 = tickLoop(retry1, graph, { error: 'timeout' });
assert.equal(retry2.retries.load, 2);
const failed = tickLoop(retry2, graph, { error: 'timeout' });
assert.equal(failed.state, 'FAILED');
assert.match(failed.stop_reason, /RETRY_BUDGET_EXCEEDED/);

const stopped = tickLoop(running, graph, { contradiction: true });
assert.equal(stopped.state, 'STOPPED');
assert.equal(stopped.stop_reason, 'CONTRADICTION_DETECTED');

const done1 = tickLoop(running, graph, { node_status: { load: 'COMPLETED' } });
assert.equal(done1.current_node, 'verify');
const done2 = tickLoop(done1, graph, { node_status: { verify: 'COMPLETED' } });
assert.equal(done2.state, 'COMPLETED');
assert.equal(done2.current_node, null);

assert.throws(
  () => startLoop({ ...graph, execution_state: 'ENABLED' }),
  /disabled execution graph/,
);

console.log('ECC AUTONOMOUS LOOP TEST: PASS');
