const assert = require('node:assert/strict');
const { assess, ACTIONS } = require('../meta-reasoning/engine-v1.js');

function evidence(overrides={}) {
  return [
    {source_id:'s1', observed:true, verified:true, relevant:true, ...overrides}
  ];
}

let r = assess({task:'simple classification', confidence:0.9, evidence:evidence({})});
assert.equal(r.status, ACTIONS.PROCEED);
assert.equal(r.should_not_act, false);

r = assess({task:'critical production migration', risk:0.9, destructive:true, confidence:0.7, evidence:[]});
assert.equal(r.status, ACTIONS.ABSTAIN);
assert.equal(r.evidence_sufficient, false);
assert.equal(r.should_not_act, true);

r = assess({task:'research a changing policy', confidence:0.95, evidence:[{source_id:'s1',observed:true,verified:true,relevant:true}], needs_research:true});
assert.equal(r.status, ACTIONS.INVESTIGATE);

r = assess({task:'retry failed strategy', confidence:0.95, evidence:[{source_id:'s1',observed:true,verified:true,relevant:true},{source_id:'s2',observed:true,verified:true,relevant:true}], current_strategy:'same', strategy_history:[{strategy:'same',outcome:'failed'},{strategy:'same',outcome:'failed'}], skills:[{skill_id:'better-skill',available:true,fit_score:0.92}]});
assert.equal(r.status, ACTIONS.BETTER_SKILL);
assert.equal(r.failure_assessment.repeated_failure_pattern, true);

r = assess({task:'action requiring human approval', confidence:0.99, evidence:evidence({}), requires_human_approval:true});
assert.equal(r.status, ACTIONS.HUMAN_GATE);

r = assess({task:'ambiguous action', confidence:0.9, evidence:[{source_id:'s1',observed:true,verified:true,relevant:true}], ambiguity:0.8});
assert.equal(r.status, ACTIONS.INVESTIGATE);

r = assess({task:'test uncertain path', confidence:0.95, evidence:evidence({}), experiment_preferred:true});
assert.equal(r.status, ACTIONS.EXPERIMENT);

r = assess({task:'delegate specialized analysis', confidence:0.95, evidence:evidence({}), agents:[{agent_id:'analyst',available:true,fit_score:0.95}]});
assert.equal(r.status, ACTIONS.DELEGATE);

console.log('meta-reasoning-v1 tests: ok');
