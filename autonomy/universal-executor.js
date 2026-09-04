'use strict';

const { selectExecutor } = require('./universal-execution/selector');
const { listExecutors } = require('./universal-execution/lookup');
const { createAdapterRegistry } = require('./universal-execution/adapters');
const { createDispatchBoundary } = require('./universal-execution/dispatch-boundary');

function createUniversalExecutor({
  activation,
  deviceDispatcher,
  agentExecutors = {},
  executorRegistry = null,
  adapterRegistry = null
} = {}) {
  if (!activation || typeof activation.execute !== 'function') throw new TypeError('activation runtime required');

  const registry = executorRegistry || { list: listExecutors };
  const adapters = adapterRegistry || createAdapterRegistry({
    activation,
    deviceDispatcher,
    agentExecutors
  });
  const dispatchBoundary = createDispatchBoundary({ adapters });

  async function execute({ missionId, mission, step, attempt, policy, request = {} } = {}) {
    if (!step || typeof step !== 'object') throw new TypeError('step required');

    const selected = selectExecutor(step, registry);
    const result = await dispatchBoundary.dispatch({
      missionId,
      mission,
      step: { ...step, executor_type: selected.type },
      attempt,
      policy,
      request,
      selection: selected
    });

    return {
      ...result,
      executor_type: result?.executor_type || selected.type,
      executor_selection: result?.executor_selection || selected
    };
  }

  return Object.freeze({ execute, adapters, dispatchBoundary });
}

module.exports = Object.freeze({ createUniversalExecutor });
