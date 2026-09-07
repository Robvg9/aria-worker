const assert = require('node:assert/strict');
const { decideRoute, version } = require('../router/meta-route-v1.js');

assert.equal(version, 'router-meta-overlay-v1');
let r = decideRoute({
  task:'prepare a safe analysis',
  capability:'text_generation',
  confidence:0.95,
  evidence:[
    {source_id:'s1',observed:true,verified:true,relevant:true},
    {source_id:'s2',observed:true,verified:true,relevant:true}
  ]
});
assert.equal(r.status, 'proceed');
assert.equal(r.meta_overlay_version, version);
assert.ok(r.economic_decision);
assert.ok(r.route);

r = decideRoute({task:'dangerous irreversible operation', capability:'text_generation', confidence:0.9, evidence:[], destructive:true, risk:0.95});
assert.equal(r.status, 'abstain');
assert.equal(r.should_not_act, true);

r = decideRoute({task:'operation requiring person', capability:'text_generation', confidence:0.99, evidence:[{source_id:'s1',observed:true,verified:true,relevant:true}], requires_human_approval:true});
assert.equal(r.status, 'human_gate');
assert.equal(r.should_not_act, true);

console.log('router-meta-overlay-v1 tests: ok');
