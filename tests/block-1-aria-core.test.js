'use strict';

/** BLOCK 1/9 — ARIA CORE verification. Pure/mock tests; no network and no secrets. */
const assert = require('assert');
const { getIdentity, createCoreContext } = require('../core/identity');
const { createSessionManager } = require('../session/manager');
const { makePlan } = require('../planning/planner');
const { STATES, TRANSITIONS, createTask, transition } = require('../tasks/state-machine');
const { createSelfStateProvider } = require('../self/state');

let passed = 0;
function ok(condition, message) { assert.ok(condition, message); passed++; console.log('PASS:', message); }
function eq(a, b, message) { assert.strictEqual(a, b, message); passed++; console.log('PASS:', message); }

async function main() {
  // 1.1 Identity
  const id = getIdentity();
  eq(id.id, 'aria', '1.1 identity id');
  eq(id.name, 'ARIA', '1.1 identity name');
  eq(id.memory_authority, 'chatbending', '1.1 memory authority declared');
  eq(id.execution_authority, 'governance-gated', '1.1 execution remains governed');
  const ctx = createCoreContext({ environment: 'test' });
  eq(ctx.environment, 'test', '1.1 core context supports explicit non-secret metadata');
  assert.throws(() => createCoreContext(null)); passed++; console.log('PASS: 1.1 invalid context rejected');

  // 1.2 Session
  let clock = 0;
  const now = () => `2026-01-01T00:00:0${clock++}Z`;
  const sessions = createSessionManager({ now });
  let s = await sessions.create({ id: 'sess_test', context: { project: 'aria' } });
  eq(s.state, 'active', '1.2 session starts active');
  s = await sessions.appendTurn('sess_test', { role: 'user', content: 'hello' });
  eq(s.turns.length, 1, '1.2 turn persisted in injected store');
  s = await sessions.setContext('sess_test', { task: 'block-1' });
  eq(s.context.task, 'block-1', '1.2 context patch retained');
  s = await sessions.close('sess_test');
  eq(s.state, 'closed', '1.2 close transitions session');
  await assert.rejects(() => sessions.resume('sess_test'), /session_closed/); passed++; console.log('PASS: 1.2 closed session cannot resume');

  // 1.3 Planner
  const plan = makePlan({ goal: 'inspect repo' }, {
    discoverTools: () => [{ id: 'github.read', capability: 'repository_read' }],
    strategy: ({ goal }) => [{ id: 'step_1', action: `Analyze: ${goal}`, tool_id: 'github.read' }]
  });
  eq(plan.plan_version, 'aria-planner-v1.0.0', '1.3 plan version');
  eq(plan.steps[0].state, 'planned', '1.3 plan does not execute steps');
  eq(plan.steps[0].tool_id, 'github.read', '1.3 planner records selected tool');
  assert.throws(() => makePlan('', {}), /goal/); passed++; console.log('PASS: 1.3 empty goal rejected');
  assert.throws(() => makePlan('x', { strategy: () => [{ id: 'a', action: 'a', depends_on: ['missing'] }] }), /dependency/); passed++; console.log('PASS: 1.3 invalid dependency rejected');

  // 1.4 Task state machine
  eq(STATES.join(','), 'planned,running,waiting,completed,failed,cancelled', '1.4 canonical states');
  eq(TRANSITIONS.planned.includes('running'), true, '1.4 planned→running allowed');
  eq(TRANSITIONS.completed.length, 0, '1.4 completed is terminal');
  let task = createTask({ id: 'task_1', goal: 'do x' });
  task = transition(task, 'running');
  eq(task.state, 'running', '1.4 running transition');
  task = transition(task, 'completed');
  eq(task.state, 'completed', '1.4 completed transition');
  assert.throws(() => transition(task, 'running'), /invalid_transition/); passed++; console.log('PASS: 1.4 terminal transition rejected');

  // 1.5 Self-State — explicit allowlist, no secret surfaces
  const self = createSelfStateProvider({
    identity: () => ({ id: 'aria', name: 'ARIA', role: 'autonomous-ai-agent', secret: 'DO_NOT_EXPORT' }),
    version: () => '1.5.0',
    capabilities: () => [{ id: 'planning', status: 'available' }, { id: 'internal', secret: 'never' }],
    tools: () => [{ id: 'github.read', status: 'available' }],
    health: () => ({ status: 'healthy', detail: 'mock' }),
    pending: () => [{ id: 'block-2', status: 'pending', secret: 'never' }],
    now: () => '2026-09-03T00:00:00Z'
  });
  const snap = self.snapshot();
  eq(snap.identity.name, 'ARIA', '1.5 self-state identity');
  eq(snap.version, '1.5.0', '1.5 self-state version');
  eq(snap.health.status, 'healthy', '1.5 health surface');
  ok(JSON.stringify(snap).indexOf('DO_NOT_EXPORT') === -1, '1.5 identity secret field not exported');
  ok(JSON.stringify(snap).indexOf('"secret"') === -1, '1.5 arbitrary secret fields not exported');

  console.log(`BLOCK 1/9 PASS: ${passed} assertions`);
}

main().catch((err) => { console.error(err); process.exit(1); });
