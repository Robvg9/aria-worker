'use strict';
const assert = require('node:assert/strict');
const { upsertEntity, addRelation, activeAt, contradictions, attachProvenance, consolidateEvidence, repairContradictions, validateConfidence } = require('../memory/world-model');

const entity = attachProvenance(upsertEntity([], { id:'e1', name:'ARIA', confidence:0.8 }), { source:'chatbending', kind:'fact' });
assert.equal(entity.confidence, 0.8);
assert.equal(entity.provenance.source, 'chatbending');
assert.throws(() => validateConfidence(1.1), /confidence_invalid/);
assert.equal(addRelation([], { from:'e1', to:'e2', type:'uses', confidence:0.7 }).length, 1);
assert.equal(activeAt({ valid_from:'2026-01-01T00:00:00Z', valid_until:'2027-01-01T00:00:00Z' }, '2026-09-06T00:00:00Z'), true);
const items = [
  attachProvenance({ subject:'runtime', content:'v18', confidence:0.9 }, { source:'prod-a' }),
  attachProvenance({ subject:'runtime', content:'v18', confidence:0.7 }, { source:'prod-b' }),
  attachProvenance({ subject:'runtime', content:'v17', confidence:0.4 }, { source:'old-log' })
];
assert.equal(contradictions(items).length, 1);
assert.equal(consolidateEvidence(items).length, 2);
assert.equal(consolidateEvidence(items)[0].confidence, 0.9);
const repaired = repairContradictions(items);
assert.equal(repaired[0].winner.content, 'v18');
assert.equal(repaired[0].rejected.length, 1);
console.log('WORLD MODEL V3: PASS — provenance, confidence, temporal validity, consolidation and contradiction repair');
