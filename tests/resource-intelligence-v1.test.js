const assert = require('assert');
const ri = require('../resource-intelligence/engine.js');

const candidates = [
  {provider_id:'p-expensive',account_id:'a1',model_id:'m-premium',quality_score:0.98,cost_per_1k_input_usd:0.02,cost_per_1k_output_usd:0.04,latency_ms:900,compute_units:8,risk_score:0.15,capabilities:['research']},
  {provider_id:'p-cheap',account_id:'a2',model_id:'m-efficient',quality_score:0.88,cost_per_1k_input_usd:0.001,cost_per_1k_output_usd:0.002,latency_ms:350,compute_units:2,risk_score:0.10,capabilities:['research']},
  {provider_id:'p-weak',account_id:'a3',model_id:'m-weak',quality_score:0.50,cost_per_1k_input_usd:0,cost_per_1k_output_usd:0,latency_ms:10,compute_units:1,risk_score:0.05,capabilities:['research']},
];

const selected = ri.decide({task:'research and analyze a complex architecture question',requirements:{capability:'research'},risk_tolerance:0.20,candidates});
assert.equal(selected.status,'selected');
assert.equal(selected.selected.model_id,'m-efficient');
assert.equal(selected.models_needed.length,1);
assert.ok(selected.estimated_tokens.total > 0);
assert.ok(selected.estimated_cost_usd >= 0);
assert.ok(selected.estimated_latency_ms > 0);
assert.ok(selected.expected_value > 0);

const constrained = ri.decide({task:'simple extraction',requirements:{capability:'research'},max_cost_usd:0.00001,risk_tolerance:0.20,candidates});
assert.equal(constrained.status,'no_resource');

const riskyOnly = ri.decide({task:'production migration',risk_tolerance:0.05,candidates:[candidates[0]]});
assert.equal(riskyOnly.status,'no_resource');
assert.equal(riskyOnly.reason,'no_eligible_candidate');

const bad = ri.decide({task:'',candidates});
assert.equal(bad.status,'insufficient_evidence');
assert.equal(bad.reason,'invalid_task');

const incomplete = {...candidates[1]};
delete incomplete.compute_units;
const missingCompute = ri.decide({task:'summarize this',candidates:[incomplete]});
assert.equal(missingCompute.status,'selected');
assert.ok(missingCompute.unknown_dimensions.some(x=>x.endsWith(':compute_units')));

console.log('resource-intelligence-v1 tests: PASS');
