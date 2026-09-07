import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdvancedPlannerRuntime } from '../autonomy/advanced-planner-runtime.js';

test('advanced planner runtime exposes deterministic alternatives and bounded replanning', async () => {
  const runtime = createAdvancedPlannerRuntime({
    candidatesProvider: async () => [
      { id: 'primary', score: 100, steps: [{ id: 'p1', action: 'primary', risk: 'READ' }] },
      { id: 'fallback', score: 90, steps: [{ id: 'f1', action: 'fallback', risk: 'READ' }] },
    ],
    policy: { max_alternatives: 2, max_replans: 1, max_risk: 'READ' },
  });

  const planned = await runtime.plan({ goal: 'advanced planner integration' });
  assert.equal(planned.status, 'planned');
  assert.equal(planned.selected, 'primary');
  assert.deepEqual(planned.alternatives, ['primary', 'fallback']);
  assert.equal(planned.backtracking.enabled, true);
  assert.equal(planned.budgets.estimated.actions, 1);

  const state = runtime.start(planned);
  const replanned = runtime.replan(state, { reason: 'executor_failed' });
  assert.equal(replanned.replanning.count, 1);
  assert.equal(replanned.selected, 'fallback');
  assert.equal(replanned.selected_plan[0].id, 'f1');

  const exhausted = runtime.replan(replanned, { reason: 'fallback_failed' });
  assert.equal(exhausted.replanning.exhausted, true);
});

test('advanced planner runtime rejects over-budget plans before execution', async () => {
  const runtime = createAdvancedPlannerRuntime({
    candidatesProvider: async () => [
      { id: 'expensive', score: 100, steps: [{ id: 'e1', action: 'expensive', risk: 'READ', estimated_cost: { tokens: 500 } }] },
    ],
    budget: { limits: { tokens: 100 } },
  });
  const planned = await runtime.plan({ goal: 'budget gate' });
  assert.equal(planned.status, 'budget_blocked');
});
