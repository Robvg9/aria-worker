'use strict';

const assert = require('assert/strict');
const { STAGES, createContinuousSelfImprovementLoop } = require('../autonomy/continuous-self-improvement-v1');

(async () => {
  const trace = [];
  const stages = Object.fromEntries(STAGES.map((stage, index) => [stage, async (ctx) => {
    trace.push(`${ctx.cycle}:${stage}`);
    if (stage === 'execute') assert.equal(ctx.plan.status, 'ok');
    if (stage === 'verify') assert.equal(ctx.execute.status, 'ok');
    if (stage === 'promote') assert.equal(ctx.test.status, 'ok');
    return { status: stage === 'better_aria' ? 'completed' : 'ok', index };
  }]));

  const loop = createContinuousSelfImprovementLoop(stages, { maxCycles: 1 });
  const result = await loop.run({ goal: 'LIVE cognitive evolution contract' });

  assert.equal(result.status, 'completed');
  assert.equal(result.version, 'continuous-self-improvement-v1');
  assert.deepEqual(result.stages, STAGES);
  assert.deepEqual(result.cycles[0].results.better_aria.status, 'completed');
  assert.equal(result.trace.length, STAGES.length);
  assert.deepEqual(result.trace.map(x => x.stage), STAGES);

  console.log(JSON.stringify({
    status: 'succeeded',
    marker: 'ARIA_CONTINUOUS_SELF_IMPROVEMENT_V1_LIVE_OK',
    version: result.version,
    stage_count: STAGES.length,
    stages: STAGES,
    cycle_count: result.cycles.length,
    stop_reason: result.stop_reason
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
