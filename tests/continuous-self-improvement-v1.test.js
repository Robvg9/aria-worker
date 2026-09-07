'use strict';

const assert = require('assert/strict');
const { STAGES, createContinuousSelfImprovementLoop } = require('../autonomy/continuous-self-improvement-v1');

(async () => {
  assert.deepEqual(STAGES, [
    'mission','observe','plan','execute','verify','reflect','learn','update_skill','identify_gap','self_develop','test','promote','better_aria'
  ]);

  const seen = [];
  const loop = createContinuousSelfImprovementLoop(Object.fromEntries(STAGES.map((stage) => [stage, async (ctx) => {
    seen.push(stage);
    return { status: stage === 'better_aria' ? 'completed' : 'ok', received: Object.keys(ctx).length > 0 };
  }])));

  const out = await loop.run({ goal: 'improve safely' });
  assert.equal(out.status, 'completed');
  assert.equal(out.version, 'continuous-self-improvement-v1');
  assert.deepEqual(seen, STAGES);
  assert.equal(out.cycles.length, 1);
  assert.equal(out.cycles[0].stopped, false);
  assert.deepEqual(out.trace.map(x => x.stage), STAGES);

  const failOrder = [];
  const failing = createContinuousSelfImprovementLoop({
    ...Object.fromEntries(STAGES.map((stage) => [stage, async () => {
      failOrder.push(stage);
      return { status: stage === 'verify' ? 'failed' : 'ok' };
    }]))
  });
  const failed = await failing.run({ goal: 'fail closed' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stop_reason, 'stage_verify');
  assert.deepEqual(failOrder, ['mission','observe','plan','execute','verify']);

  const blocked = createContinuousSelfImprovementLoop({
    ...Object.fromEntries(STAGES.map((stage) => [stage, async () => ({ status: stage === 'promote' ? 'blocked' : 'ok' })]))
  });
  const blockedResult = await blocked.run({ goal: 'promotion must gate' });
  assert.equal(blockedResult.status, 'blocked');
  assert.equal(blockedResult.stop_reason, 'stage_promote');

  const bounded = createContinuousSelfImprovementLoop({
    ...Object.fromEntries(STAGES.map((stage) => [stage, async () => ({ status: 'ok' })])),
    maxCycles: 2
  });
  const boundedResult = await bounded.run({ goal: 'bounded evolution' });
  assert.equal(boundedResult.status, 'blocked');
  assert.equal(boundedResult.stop_reason, 'max_cycles');
  assert.equal(boundedResult.cycles.length, 2);

  assert.throws(() => createContinuousSelfImprovementLoop({ ...Object.fromEntries(STAGES.map(s => [s, async () => ({status:'ok'})])), maxCycles: 11 }), /maxCycles/);
  assert.throws(() => createContinuousSelfImprovementLoop({}), /mission function required/);

  console.log('CONTINUOUS SELF-IMPROVEMENT V1: PASS — full cognitive evolution loop, fail-closed gates, bounded cycles, deterministic stage trace');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
