'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  failureSignature,
  deriveFailurePreventionProcedure,
  validateLearningApplication,
} = require('../learning/mastery-gate');

test('failure signature is stable across formatting changes', () => {
  const a = failureSignature({ goal: 'Deploy Edge Function', error_code: 'IMPORT_MAP', operation: 'deploy' });
  const b = failureSignature({ goal: ' Deploy   Edge Function ', error_code: 'import_map', operation: 'deploy' });
  assert.equal(a, b);
});

test('failure learning derives concrete prevention from deployment evidence', () => {
  const procedure = deriveFailurePreventionProcedure({
    goal: 'deploy edge function',
    failureDetail: 'deno.json import_map configuration blocked deployment',
    nextAction: 'verify import_map_path before deploy',
  });
  assert.ok(procedure.some((step) => /deno\.json/i.test(step)));
  assert.ok(procedure.some((step) => /regresi[oó]n/i.test(step)));
  assert.ok(procedure.length >= 5);
});

test('learning application gate rejects a plan that ignores an active learned preflight', () => {
  const skills = [{
    memory_id: 'skill-1',
    title: 'Supabase Edge Function deployment preflight',
    confidence: 0.98,
    status: 'active',
    metadata: {
      preflight_required: true,
      preflight_requirements: { mode: 'contains_all', terms: ['deno.json', 'import_map'] },
    },
  }];
  const blocked = validateLearningApplication({
    plan: [{ operation: 'deploy', executor_type: 'connector', input: { command: 'supabase functions deploy' } }],
    skills,
  });
  assert.equal(blocked.passed, false);
  assert.deepEqual(blocked.missing.map((x) => x.memory_id), ['skill-1']);

  const passed = validateLearningApplication({
    plan: [{ operation: 'preflight', executor_type: 'connector', input: { files: ['deno.json'], config: 'import_map' } }, { operation: 'deploy', executor_type: 'connector' }],
    skills,
  });
  assert.equal(passed.passed, true);
  assert.deepEqual(passed.applied_memory_ids, ['skill-1']);
});
