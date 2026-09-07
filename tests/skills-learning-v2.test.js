import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractLesson, promoteToSkill, createLearningEngine } = require('../learning/engine.js');

const verifier = { version: 'smart-verifier-v1', passed: true, failed_checks: [] };
const episode = {
  goal: 'learn verified procedure',
  result: { status: 'succeeded' },
  procedure: ['plan', 'execute', 'verify'],
  evidence_refs: ['mission:skills-live-001'],
};

test('learning engine extracts evidence-backed lesson', () => {
  const lesson = extractLesson({ episode, verifier });
  assert.equal(lesson.category, 'verified_procedure');
  assert.equal(lesson.reusable, true);
  assert.equal(lesson.confidence, 0.92);
  assert.equal(typeof lesson.content_hash, 'string');
});

test('only verified reusable lessons above threshold promote', () => {
  const lesson = extractLesson({ episode, verifier });
  const promoted = promoteToSkill(lesson);
  assert.equal(promoted.promoted, true);
  const blocked = promoteToSkill({ ...lesson, confidence: 0.89 });
  assert.equal(blocked.promoted, false);
});

test('failed verification produces diagnostic non-reusable lesson', () => {
  const lesson = extractLesson({ episode: { ...episode, result: { status: 'failed' } }, verifier: { ...verifier, passed: false, failed_checks: ['semantic:mismatch'] } });
  assert.equal(lesson.category, 'diagnostic');
  assert.equal(lesson.reusable, false);
  assert.ok(lesson.confidence < 0.5);
});

test('learning engine persists lesson and only persists promoted skill', async () => {
  const saved = { lessons: [], skills: [] };
  const engine = createLearningEngine({
    persistLesson: async (lesson) => saved.lessons.push(lesson),
    persistSkill: async (skill) => saved.skills.push(skill),
  });
  const result = await engine.learn({ episode, verifier });
  assert.equal(result.version, 'skills-learning-v2');
  assert.equal(saved.lessons.length, 1);
  assert.equal(saved.skills.length, 1);
  assert.equal(saved.skills[0].promotion.status, 'verified');
});
