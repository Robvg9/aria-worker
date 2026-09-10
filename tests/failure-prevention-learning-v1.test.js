'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { extractLesson, promoteToSkill, createLearningEngine } = require('../learning/engine.js');

const verifier = { version: 'smart-verifier-v1', passed: true, failed_checks: [] };
const failedEpisode = {
  goal: 'recover from deployment failure',
  capability_id: 'deployment',
  learning_mode: 'failure_prevention',
  result: { status: 'failed' },
  procedure: ['bad-deploy-attempt'],
  prevention_procedure: ['preflight-config', 'verify-artifact', 'deploy'],
  evidence_refs: ['mission:failure-prevention-001', 'verification:prevention-001']
};

test('verified prevention converts a real failure into reusable knowledge', () => {
  const lesson = extractLesson({ episode: failedEpisode, verifier });
  assert.equal(lesson.category, 'failure_prevention');
  assert.equal(lesson.reusable, true);
  assert.deepEqual(lesson.procedure, failedEpisode.prevention_procedure);
  assert.equal(lesson.evidence.outcome_status, 'failed');
  const promotion = promoteToSkill(lesson);
  assert.equal(promotion.promoted, true);
});

test('an unverified failure remains diagnostic', () => {
  const lesson = extractLesson({ episode: failedEpisode, verifier: { ...verifier, passed: false } });
  assert.equal(lesson.category, 'diagnostic');
  assert.equal(lesson.reusable, false);
  assert.equal(promoteToSkill(lesson).promoted, false);
});

test('learning persists a promoted prevention skill and regression', async () => {
  const saved = { lessons: [], skills: [], regressions: [] };
  const engine = createLearningEngine({
    persistLesson: async x => saved.lessons.push(x),
    persistSkill: async x => saved.skills.push(x),
    persistRegression: async x => saved.regressions.push(x)
  });
  const result = await engine.learn({ episode: failedEpisode, verifier });
  assert.equal(result.lesson.category, 'failure_prevention');
  assert.equal(result.promotion.promoted, true);
  assert.equal(saved.skills.length, 1);
  assert.equal(saved.regressions.length, 1);
  assert.equal(saved.skills[0].regression.status, 'generated');
});

console.log('FAILURE PREVENTION LEARNING V1: PASS');
