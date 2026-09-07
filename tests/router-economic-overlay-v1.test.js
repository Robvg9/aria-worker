const assert = require('assert');
const { economicallySelect } = require('../router/economic-route-v1.js');

const result = economicallySelect({
  task: 'analyze a complex architecture question',
  capability: 'research',
  risk_tolerance: 0.20,
  max_cost_usd: 0.05,
  economic_candidates: [
    {provider_id:'p-a',account_id:'a',model_id:'m-premium',quality_score:0.98,cost_per_1k_input_usd:0.02,cost_per_1k_output_usd:0.04,latency_ms:800,compute_units:8,risk_score:0.15,capabilities:['research']},
    {provider_id:'p-b',account_id:'b',model_id:'m-efficient',quality_score:0.88,cost_per_1k_input_usd:0.001,cost_per_1k_output_usd:0.002,latency_ms:300,compute_units:2,risk_score:0.10,capabilities:['research']},
  ]
});

assert.equal(result.status, 'selected');
assert.equal(result.selected.model_id, 'm-efficient');
assert.equal(result.router_version, 'aria-intelligent-router-v1.1');
assert.equal(result.economic_overlay_version, 'router-economic-overlay-v1');
assert.ok(result.base_route && ['selected','no_route'].includes(result.base_route.status));

const none = economicallySelect({task:'research', capability:'research', economic_candidates:[]});
assert.equal(none.status, 'no_resource');

console.log('router-economic-overlay-v1 tests: PASS');
