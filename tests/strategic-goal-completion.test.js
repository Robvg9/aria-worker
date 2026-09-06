import assert from 'node:assert/strict';
import test from 'node:test';
import { hasActionableProgress, strategicProgressRequired, verifyStrategicCompletion } from '../supabase/functions/_shared/strategic-goal-completion.mjs';

test('strategic implementation goals require actionable progress', () => {
  assert.equal(strategicProgressRequired('Integrar Credential Health con el flujo autónomo', 'priority'), true);
  assert.equal(hasActionableProgress([{ operation: 'file_read', risk: 'READ' }]), false);
  assert.deepEqual(
    verifyStrategicCompletion({
      goal: 'Integrar Credential Health con el flujo autónomo',
      goalSource: 'priority',
      steps: [{ operation: 'file_read', risk: 'READ' }],
    }),
    { required: true, verified: false, reason: 'read_only_plan_cannot_complete_strategic_implementation_goal' },
  );
});

test('audits and non-strategic goals can still complete from successful read-only evidence', () => {
  assert.deepEqual(
    verifyStrategicCompletion({ goal: 'Audita la capa Multi-IA', goalSource: 'priority', steps: [{ operation: 'file_read' }] }),
    { required: false, verified: true, reason: 'not_strategic_implementation_goal' },
  );
  assert.deepEqual(
    verifyStrategicCompletion({ goal: 'Integrar Credential Health', goalSource: 'priority', steps: [{ operation: 'file_write' }] }),
    { required: true, verified: true, reason: 'actionable_progress_present' },
  );
});
