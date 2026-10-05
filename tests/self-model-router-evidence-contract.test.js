'use strict';

const assert = require('node:assert/strict');
const { createSelfModelV2 } = require('../self-model/self-model-v2');
const router = require('../router/lookup');

const model = createSelfModelV2({
  identity: 'ARIA',
  canonicalEntrypoint: 'aria-canonical-runtime-v1',
  softwareVersion: require('../package.json').version,
  capabilities: [
    { id: 'text_generation', status: 'verified', confidence: 0.99, evidence: { source: 'capability_registry' }, risk: 'low', reliability: 0.98 },
    { id: 'model_routing', status: 'verified', confidence: 0.98, evidence: { source: 'router/lookup' }, dependencies: ['text_generation'], risk: 'medium', reliability: 0.97 },
    { id: 'self_model', status: 'verified', confidence: 1, evidence: { source: 'self-model-v2' }, risk: 'low', reliability: 1 },
    { id: 'external_multi_ia', status: 'blocked', confidence: 0, evidence: { source: 'human_gate' }, risk: 'critical', reliability: 0 }
  ],
  dependencies: { model_routing: ['text_generation'] },
  resources: ['models', 'capabilities', 'accounts', 'quota'],
  tools: ['router'],
  providers: router.collectCandidates('text_generation').map((x) => x.provider_id),
  router
});

const snapshot = model.refresh({
  current_activity: { mission_id: 'self-model-router-evidence-contract', state: 'certifying' }
});

assert.equal(snapshot.version, 'self-model-v2.0.0');
assert.equal(snapshot.authority.router, true);

const route = router.route({ capability: 'text_generation' });
assert.ok(['selected', 'no_route'].includes(route.status));

const selection = model.chooseBest('text_generation');
assert.equal(selection.status, 'selected');
assert.equal(selection.route?.status, route.status);

if (route.status === 'no_route') {
  assert.equal(router.collectCandidates('text_generation').length, 0);
}

assert.equal(JSON.stringify(snapshot).includes('api_key'), false);

console.log('SELF-MODEL ROUTER EVIDENCE CONTRACT: PASS');
