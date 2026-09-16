const assert = require('node:assert/strict');
const fs = require('node:fs');
const { compileVisionObjective } = await import('../autonomy/vision-objective-compiler-v1.mjs');

const compiled = compileVisionObjective({ objective_id:'vision-execution-manifest-v1', vision_id:'aria-master-vision-v1', objective:'Maintain a live execution manifest', priority:98, status:'queued', acceptance:'current objectives reflected; terminal goals never requeued', source_section:'Vision', metadata:{autonomous:true}, verifier:{type:'state_consistency',success_conditions:['current_vision_objectives_reflected','terminal_goals_not_requeued']}, dependencies:['vision-selfmodel-skillfactory-promotion-v1'] });
assert.equal(compiled.goal_id,'vision-vision-execution-manifest-v1');
assert.equal(compiled.source_type,'vision');
assert.equal(compiled.metadata.compiled,true);
assert.equal(compiled.metadata.verifier.type,'state_consistency');
assert.deepEqual(compiled.metadata.dependencies,['vision-selfmodel-skillfactory-promotion-v1']);
console.log('VISION_OBJECTIVE_COMPILER_V1_OK');
