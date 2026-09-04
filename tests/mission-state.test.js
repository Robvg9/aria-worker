'use strict';

const assert = require('node:assert/strict');
const {
  normalizeMission,
  transitionMission,
  checkpointMission,
  createMissionStateStore
} = require('../execution/mission-state');

const base = normalizeMission({ mission_id: 'm_001', goal: 'build app' });
assert.equal(base.status, 'queued');
assert.equal(base.current_step, 0);
assert.equal(base.completed_steps, 0);

assert.equal(transitionMission(base, 'planning').status, 'planning');
assert.throws(() => transitionMission(base, 'succeeded'), /invalid mission transition/);

const running = transitionMission(base, 'planning');
const active = transitionMission(running, 'running', {
  current_step: 3,
  total_steps: 10,
  current_agent_id: 'termux:phone-1',
  current_workspace: '/data/data/com.termux/files/home/aria'
});
assert.equal(active.current_step, 3);
assert.equal(active.status, 'running');

const saved = checkpointMission(active, {
  last_verified_command: 'npm test',
  last_result: 'pass',
  resume_from: 4
}, {
  last_command: 'npm test',
  last_exit_code: 0,
  last_stdout: 'tests passed',
  next_action: 'git status'
});
assert.equal(saved.checkpoint.resume_from, 4);
assert.equal(saved.last_exit_code, 0);
assert.equal(saved.next_action, 'git status');

const calls = [];
const repository = {
  async createMission(mission) { calls.push(['create', mission.mission_id]); return mission; },
  async getMission() { return saved; },
  async updateMission(id, mission) { calls.push(['update', id, mission.status]); return mission; },
  async appendEvent(id, event) { calls.push(['event', id, event.event_type]); }
};

(async () => {
  const store = createMissionStateStore(repository);
  const created = await store.create({ mission_id: 'm_002', goal: 'test autonomous state' });
  assert.equal(created.mission_id, 'm_002');
  assert.deepEqual(calls.slice(0, 2), [
    ['create', 'm_002'],
    ['event', 'm_002', 'mission_created']
  ]);

  const checkpointed = await store.checkpoint('m_001', { resume_from: 5 });
  assert.equal(checkpointed.checkpoint.resume_from, 5);
  assert.equal(calls.at(-1)[2], 'checkpoint_saved');

  console.log('mission-state tests: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
