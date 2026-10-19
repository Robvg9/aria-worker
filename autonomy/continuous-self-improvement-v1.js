'use strict';

const { detectPattern } = require('../failure-intelligence/failure-pattern-engine-v1');

const STAGES = Object.freeze([
  'mission','observe','plan','execute','verify','reflect','learn','update_skill','identify_gap','self_develop','test','promote','better_aria'
]);

const TERMINAL = Object.freeze(['completed', 'blocked', 'failed']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function safeStatus(value, fallback = 'failed') {
  return value && typeof value.status === 'string' ? value.status : fallback;
}

function normalizeStageResult(stage, value) {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
  return Object.freeze({ stage, ...result });
}

function createContinuousSelfImprovementLoop({
  mission, observe, plan, execute, verify, reflect, learn,
  updateSkill, update_skill,
  identifyGap, identify_gap,
  selfDevelop, self_develop,
  test, promote,
  betterAria, better_aria,
  failurePatternDetector = detectPattern,
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
  if (typeof failurePatternDetector !== 'function') throw new TypeError('failurePatternDetector must be a function');
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 10) {
    throw new TypeError('maxCycles must be an integer between 1 and 10');
  }

  async function run(input = {}) {
    const trace = [];
    const cycleResults = [];
    const failureHistory = Array.isArray(input.failure_history) ? input.failure_history.slice(-200) : [];
    const detectedFailurePatterns = failureHistory.length ? failurePatternDetector(failureHistory) : [];
    let context = { input, failure_patterns: detectedFailurePatterns };

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const results = {};
      let stopped = false;

      for (const stage of STAGES) {
        const stageContext = { ...context, cycle, stage, trace: trace.slice() };
        const value = await fns[stage](stageContext);
        const normalized = normalizeStageResult(stage, value);
        results[stage] = normalized;
        context = { ...context, [stage]: normalized };
        trace.push({ cycle, stage, status: safeStatus(normalized, 'failed') });

        const status = safeStatus(normalized, 'failed');
        if (status === 'blocked' || status === 'failed') {
          stopped = true;
          break;
        }
      }

      const cycleRecord = Object.freeze({ cycle, results: Object.freeze(results), stopped });
      cycleResults.push(cycleRecord);
      context = { ...context, previous_cycle: cycleRecord };

      if (safeStatus(results.better_aria, null) === 'completed') {
        return Object.freeze({
          status: 'completed', version: 'continuous-self-improvement-v1', stages: STAGES,
          cycles: cycleResults, trace, failure_patterns: detectedFailurePatterns, stop_reason: 'better_aria'
        });
      }
      if (stopped) {
        const last = Object.values(results).at(-1);
        return Object.freeze({
          status: safeStatus(last, 'failed'), version: 'continuous-self-improvement-v1', stages: STAGES,
          cycles: cycleResults, trace, failure_patterns: detectedFailurePatterns, stop_reason: `stage_${last?.stage || 'unknown'}`
        });
      }
    }

    return Object.freeze({
      status: 'blocked', version: 'continuous-self-improvement-v1', stages: STAGES,
      cycles: cycleResults, trace, failure_patterns: detectedFailurePatterns, stop_reason: 'max_cycles'
    });
  }

  return Object.freeze({ version: 'continuous-self-improvement-v1', stages: STAGES, run });
}

module.exports = Object.freeze({ STAGES, TERMINAL, createContinuousSelfImprovementLoop });
