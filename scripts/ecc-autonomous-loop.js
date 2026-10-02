'use strict';

const crypto = require('node:crypto');

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'STOPPED']);

function indexNodes(graph) {
  return new Map((graph.nodes || []).map(node => [node.id, { ...node }]));
}

function successors(graph, nodeId) {
  return (graph.edges || []).filter(edge => edge.from === nodeId).map(edge => edge.to);
}

function startLoop(graph, options = {}) {
  if (!graph || graph.schema !== 'aria.ecc-mission-graph.v1') {
    throw new Error('Unsupported mission graph schema');
  }
  if (graph.execution_state !== 'DISABLED') {
    throw new Error('Autonomous Loop requires a disabled execution graph at initialization');
  }

  const maxRetries = Number.isInteger(options.max_retries) ? Math.max(0, Math.min(options.max_retries, 3)) : 3;
  const maxTicks = Number.isInteger(options.max_ticks) ? Math.max(1, Math.min(options.max_ticks, 100)) : 20;

  const nodeMap = indexNodes(graph);
  const state = {
    schema: 'aria.ecc-autonomous-loop.v1',
    loop_id: crypto.randomUUID(),
    graph_digest_sha256: graph.graph_digest_sha256,
    state: 'READY',
    current_node: 'context',
    tick_count: 0,
    retries: {},
    max_retries: maxRetries,
    max_ticks: maxTicks,
    execution_authority: 'EXTERNAL_RUNTIME_ONLY',
    activation_state: 'DISABLED',
    permission_grants: 0,
    evidence_refs: [],
    stop_reason: null,
  };

  if (!nodeMap.has('context')) throw new Error('Mission graph lacks context node');
  return state;
}

function tickLoop(loop, graph, result = {}) {
  if (!loop || loop.schema !== 'aria.ecc-autonomous-loop.v1') throw new Error('Unsupported loop state');
  if (loop.state === 'STOPPED' || loop.state === 'COMPLETED' || loop.state === 'FAILED') return { ...loop };

  const next = { ...loop, tick_count: loop.tick_count + 1 };
  if (next.tick_count > next.max_ticks) {
    next.state = 'STOPPED';
    next.stop_reason = 'MAX_TICKS_EXCEEDED';
    return next;
  }

  if (result.contradiction) {
    next.state = 'STOPPED';
    next.stop_reason = 'CONTRADICTION_DETECTED';
    return next;
  }

  const current = loop.current_node;
  const statuses = result.node_status || {};
  const status = statuses[current];

  if (result.error) {
    const retries = { ...(loop.retries || {}) };
    retries[current] = (retries[current] || 0) + 1;
    next.retries = retries;
    if (retries[current] > loop.max_retries) {
      next.state = 'FAILED';
      next.stop_reason = `RETRY_BUDGET_EXCEEDED:${current}`;
      return next;
    }
    next.state = 'RUNNING';
    return next;
  }

  if (status === 'FAILED') {
    next.state = 'FAILED';
    next.stop_reason = `NODE_FAILED:${current}`;
    return next;
  }

  if (status === 'COMPLETED') {
    const nextNode = successors(graph, current)[0];
    if (!nextNode) {
      next.state = 'COMPLETED';
      next.current_node = null;
      return next;
    }
    next.current_node = nextNode;
    next.state = 'RUNNING';
    return next;
  }

  next.state = current === 'context' ? 'RUNNING' : 'WAITING';
  return next;
}

module.exports = { startLoop, tickLoop };
