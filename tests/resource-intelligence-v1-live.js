const assert = require('assert');
const ri = require('../resource-intelligence/engine.js');

const result = ri.decide({
  task: 'analyze a complex production architecture and propose a safe implementation plan',
  complexity: 'high',
  requirements: { capability: 'research' },
  risk_tolerance: 0.25,
  max_cost_usd: 0.05,
  max_latency_ms: 1500,
  candidates: [
    {provider_id:'provider-a',account_id:'account-a',model_id:'model-premium',quality_score:0.97,cost_per_1k_input_usd:0.012,cost_per_1k_output_usd:0.024,latency_ms:1000,compute_units:6,risk_score:0.18,capabilities:['research']},
    {provider_id:'provider-b',account_id:'account-b',model_id:'model-efficient',quality_score:0.88,cost_per_1k_input_usd:0.0012,cost_per_1k_output_usd:0.0024,latency_ms:420,compute_units:2,risk_score:0.10,capabilities:['research']},
    {provider_id:'provider-c',account_id:'account-c',model_id:'model-unsafe',quality_score:0.95,cost_per_1k_input_usd:0.0005,cost_per_1k_output_usd:0.001,latency_ms:300,compute_units:1,risk_score:0.90,capabilities:['research']},
  ]
});

assert.equal(result.status, 'selected');
assert.ok(result.models_needed.includes(result.selected.model_id));
assert.ok(result.estimated_tokens.total > 0);
assert.ok(result.estimated_latency_ms <= 1500);
assert.ok(result.estimated_cost_usd <= 0.05);
assert.ok(result.risk_score <= 0.25);
assert.equal(result.selected.model_id, 'model-efficient');
console.log('ARIA_RESOURCE_INTELLIGENCE_1_LIVE_OK');
