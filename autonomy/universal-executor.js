'use strict';

const { selectExecutor } = require('./universal-execution/selector');
const { listExecutors } = require('./universal-execution/lookup');
const { createAdapterRegistry } = require('./universal-execution/adapters');

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

  async function execute({ missionId, mission, step, attempt, policy, request = {} } = {}) {
    if (!step || typeof step !== 'object') throw new TypeError('step required');

    const selected = selectExecutor(step, registry);
    const adapter = adapters.get(selected.type);

    if (!adapter || typeof adapter.execute !== 'function') {
      return {
        status: 'blocked',
        executor_type: selected.type,
        executor_selection: selected,
        reason: 'executor_adapter_unavailable'
      };
    }

    const result = await adapter.execute({
      missionId,
      mission,
      step,
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

  return Object.freeze({ execute, adapters });
}

module.exports = Object.freeze({ createUniversalExecutor });
