'use strict';

/**
 * Adapter between Advanced Planner v1 and autonomous mission orchestration.
 * Planning/replanning only; execution remains delegated to the canonical executor.
 */
const {
  planAdvanced,
  advanceAlternative,
  replanFromFailure,
  createBacktrackingState,
} = require('../planning/advanced-planner');

function createAdvancedPlannerRuntime({ candidatesProvider, policy = {}, budget = {} } = {}) {
  if (typeof candidatesProvider !== 'function') throw new TypeError('candidatesProvider function required');

  async function plan({ goal, context } = {}) {
    const candidates = await candidatesProvider({ goal, context });
    return planAdvanced({ goal, candidates, policy, budget });
  }

  function start(planResult) {
    return createBacktrackingState(planResult);
  }

  function replan(state, failure = {}) {
    return replanFromFailure(state, failure);
  }

  function next(state) {
    return advanceAlternative(state);
  }

  return Object.freeze({ policy: { ...policy }, budget: { ...budget }, plan, start, replan, next });
}

module.exports = Object.freeze({ createAdvancedPlannerRuntime });
