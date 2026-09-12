'use strict';

const assert = require('node:assert/strict');
const { STATUS, createSkillRegistry } = require('../learning/skill-registry-v1');

(() => {
  assert.deepEqual(STATUS, ['candidate', 'verified', 'degraded', 'retired']);
  const registry = createSkillRegistry({ minConfidence: 0.9, minEvidence: 1 });
  const candidate = registry.put({
    capability: 'demo',
    summary: 'demo skill',
    confidence: 0.8,
    reusable: true,
    evidence: { verified: true, evidence_refs: ['e1'] },
    procedure: ['observe', 'act', 'verify']
  });
  assert.equal(candidate.status, 'candidate');

  const verified = registry.put({
    skill_key: 'demo',
    summary: 'demo skill v2',
    confidence: 0.95,
    reusable: true,
    evidence: { verified: true, evidence_refs: ['e2', 'e3'] },
    procedure: ['observe', 'act', 'verify']
  });
  assert.equal(verified.status, 'verified');
  assert.equal(verified.version_number, 2);

  registry.recordOutcome('demo', 'succeeded');
  registry.recordOutcome('demo', 'succeeded');
  let current = registry.recordOutcome('demo', 'failed');
  assert.equal(current.uses, 3);
  assert.equal(current.successes, 2);

  current = registry.recordRegression('demo');
  assert.equal(current.status, 'degraded');
  assert.equal(registry.resolve('demo'), null);
  assert.equal(registry.resolve('demo', { allowDegraded: true }).status, 'degraded');

  registry.retire('demo', 'superseded');
  assert.equal(registry.resolve('demo', { allowDegraded: true }), null);
  assert.equal(registry.snapshot().length, 1);
  assert.equal(registry.rank({ includeCandidates: true })[0].status, 'retired');

  console.log('SKILL_REGISTRY_V1=PASS — candidate/verified lifecycle, versioning, outcome telemetry, regression degradation and retirement');
})();
