'use strict';
const assert = require('assert');
const { normalizeMission, transitionMission, checkpointMission, createMissionStateStore } = require('../execution/mission-state.js');

const base = normalizeMission({ mission_id: 'mission_001', goal: 'build app' });
assert.strictEqual(base.status, 'queued');
assert.throws(() => normalizeMission({ mission_id: 'x', goal: 'y', status: 'bad' }), /invalid mission status/);
assert.strictEqual(transitionMission(base, 'planning').status, 'planning');
assert.throws(() => transitionMission(base, 'succeeded'), /invalid mission transition/);
const running = transitionMission(transitionMission(base, 'planning'), 'running', { current_step: 3, total_steps: 10 });
const cp = checkpointMission(running, { next: 'npm test', workspace: '/tmp/app' }, { completed_steps: 3, next_action: 'run tests' });
assert.strictEqual(cp.current_step, 3);
assert.strictEqual(cp.completed_steps, 3);
assert.strictEqual(cp.checkpoint.next, 'npm test');
const terminal = transitionMission(cp, 'succeeded');
assert.strictEqual(terminal.status, 'succeeded');
assert.ok(terminal.finished_at);
assert.throws(() => transitionMission(terminal, 'running'), /invalid mission transition/);

(async () => {
  const events = []; let stored = null;
  const repo = {
    async createMission(m) { stored = m; return stored; },
    async getMission() { return stored; },
    async updateMission(_id, m) { stored = m; return stored; },
    async appendEvent(_id, event) { events.push(event); }
  };
  const store = createMissionStateStore(repo);
  await store.create({ mission_id: 'mission_store', goal: 'persist me' });
  await store.transition('mission_store', 'planning');
  await store.transition('mission_store', 'running');
  await store.checkpoint('mission_store', { step: 2 }, { current_step: 2, completed_steps: 1, next_action: 'continue' });
  assert.strictEqual((await store.get('mission_store')).checkpoint.step, 2);
  assert.ok(events.some(e => e.event_type === 'checkpoint_saved'));
  console.log('mission-state.test.js: PASS');
})().catch(err => { console.error(err); process.exitCode = 1; });
