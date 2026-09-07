'use strict';

const STAGES = Object.freeze([
  'mission','observe','plan','execute','verify','reflect','learn','update_skill','identify_gap','self_develop','test','promote','better_aria'
]);

const TERMINAL = Object.freeze(['completed', 'blocked', 'failed']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function safeStatus(value, fallback = 'failed') {
  const status = value && typeof value.status === 'string' ? value.status : fallback;
  return status;
}

function normalizeStageResult(stage, value) {
  const result = value && typeof value === 'object' ? value : { value };
  return Object.freeze({ stage, ...result });
}

function createContinuousSelfImprovementLoop({
  mission, observe, plan, execute, verify, reflect, learn,
  updateSkill, update_skill,
  identifyGap, identify_gap,
  selfDevelop, self_develop,
  test, promote,
  betterAria, better_aria,
  maxCycles = 1
} = {}) {
  const fns = {
    mission, observe, plan, execute, verify, reflect, learn,
    update_skill: update_skill || updateSkill,
    identify_gap: identify_gap || identifyGap,
    self_develop: self_develop || selfDevelop,
    test, promote,
    better_aria: better_aria || betterAria
  };
  for (const stage of STAGES) requireFn(fns[stage], stage);
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 10) {
    throw new TypeError('maxCycles must be an integer between 1 and 10');
  }

  async function run(input = {}) {
    const trace = [];
    const cycleResults = [];
    let context = { input };

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const results = {};
      let stopped = false;

      for (const stage of STAGES) {
        const value = await fns[stage]({ ...context, cycle, stage, trace: trace.slice() });
        const normalized = normalizeStageResult(stage, value);
        results[stage] = normalized;
        trace.push({ cycle, stage, status: safeStatus(normalized, 'ok') });

        const status = safeStatus(normalized, 'ok');
        if (status === 'blocked' || status === 'failed') {
          stopped = true;
          break;
        }
      }

      const cycleRecord = Object.freeze({ cycle, results: Object.freeze(results), stopped });
      cycleResults.push(cycleRecord);
      context = { ...context, ...results, previous_cycle: cycleRecord };

      const finalStage = results.better_aria;
      if (safeStatus(finalStage, null) === 'completed') {
        return Object.freeze({
          status: 'completed', version: 'continuous-self-improvement-v1', stages: STAGES,
          cycles: cycleResults, trace, stop_reason: 'better_aria'
        });
      }
      if (stopped) {
        const last = Object.values(results).at(-1);
        return Object.freeze({
          status: safeStatus(last, 'failed'), version: 'continuous-self-improvement-v1', stages: STAGES,
          cycles: cycleResults, trace, stop_reason: `stage_${last?.stage || 'unknown'}`
        });
      }
    }

    return Object.freeze({
      status: 'blocked', version: 'continuous-self-improvement-v1', stages: STAGES,
      cycles: cycleResults, trace, stop_reason: 'max_cycles'
    });
  }

  return Object.freeze({ version: 'continuous-self-improvement-v1', stages: STAGES, run });
}

module.exports = Object.freeze({ STAGES, TERMINAL, createContinuousSelfImprovementLoop });
