'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  planAdvanced,
  rankCandidates,
  advanceAlternative,
  replanFromFailure,
  createBacktrackingState,
} = require('../planning/advanced-planner');

test('advanced planner ranks deterministic alternatives and keeps best branch first', () => {
  const result = planAdvanced({
    goal: 'choose a safe route',
    policy: { max_alternatives: 3, max_replans: 2, max_risk: 'HIGH' },
    candidates: [
      { id: 'slow', score: 70, steps: [{ id: 's1', action: 'slow', risk: 'LOW', estimated_cost: { actions: 4 } }] },
      { id: 'fast', score: 90, steps: [{ id: 'f1', action: 'fast', risk: 'LOW' }] },
      { id: 'risky', score: 99, steps: [{ id: 'r1', action: 'risky', risk: 'CRITICAL' }] },
    ],
  });
  assert.equal(result.status, 'planned');
  assert.equal(result.selected, 'fast');
  assert.deepEqual(result.alternatives, ['fast', 'slow']);
  assert.equal(result.backtracking.enabled, true);
  assert.equal(result.replanning.max_replans, 2);
});

test('budget gate closes plans that exceed declared resources', () => {
  const result = planAdvanced({
    goal: 'budgeted route',
    budget: { limits: { actions: 1 } },
    candidates: [
      { id: 'over', score: 100, steps: [
        { id: 'a', action: 'a', risk: 'LOW' },
        { id: 'b', action: 'b', risk: 'LOW' },
      ] },
    ],
  });
  assert.equal(result.status, 'budget_blocked');
});

test('backtracking advances exactly one deterministic alternative', () => {
  const planned = planAdvanced({
    goal: 'backtrack',
    candidates: [
      { id: 'a', score: 100, steps: [{ id: 'a1', action: 'a', risk: 'LOW' }] },
      { id: 'b', score: 90, steps: [{ id: 'b1', action: 'b', risk: 'LOW' }] },
    ],
  });
  const state = createBacktrackingState(planned);
  const next = advanceAlternative(state);
  assert.equal(next.selected, 'b');
  assert.equal(next.backtracking.cursor, 1);
  assert.equal(next.backtracking.exhausted, false);
});

test('replanning consumes one budgeted replan and records failure reason', () => {
  const planned = planAdvanced({
    goal: 'replan',
    policy: { max_replans: 1 },
    candidates: [
      { id: 'primary', score: 100, steps: [{ id: 'p1', action: 'primary', risk: 'LOW' }] },
      { id: 'backup', score: 80, steps: [{ id: 'b1', action: 'backup', risk: 'LOW' }] },
    ],
  });
  const state = createBacktrackingState(planned);
  const next = replanFromFailure(state, { code: 'route_failed' });
  assert.equal(next.selected, 'backup');
  assert.equal(next.replanning.count, 1);
  assert.equal(next.replanning.last_failure, 'route_failed');
  const exhausted = replanFromFailure(next, { code: 'backup_failed' });
  assert.equal(exhausted.replanning.exhausted, true);
});

test('invalid and duplicate alternatives are rejected from the ranked set', () => {
  const ranked = rankCandidates([
    { id: 'a', score: 10, steps: [{ id: 'a1', action: 'same', risk: 'LOW' }] },
    { id: 'dup', score: 99, steps: [{ id: 'a1', action: 'same', risk: 'LOW' }] },
    { id: 'bad', score: 100, steps: [{ id: 'x', action: 'bad', risk: 'INVALID' }] },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'a');
});
