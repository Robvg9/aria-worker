'use strict';

const { createConnectorAdapter } = require('./connector');
const { createDeviceAdapter } = require('./device');
const { createAgentAdapter } = require('./agent');
const canonicalExecution = require('../../../execution/lookup');

function createModelAdapter({ executionEngine = canonicalExecution } = {}) {
  if (!executionEngine || typeof executionEngine.execute !== 'function') throw new TypeError('model execution engine required');
  return Object.freeze({
    adapter_id: 'canonical-model-execution-v1',
    executor_type: 'model',
    status: 'ready',
    operations: ['text_generation'],
    async execute({ missionId, step, policy }) {
      const target = step.target || {};
      const authorization = step.authorization && typeof step.authorization === 'object'
        ? step.authorization
        : { status: 'blocked', risk_class: step.risk || 'READ', evidence_ref: null };
      const capability = step.operation || 'text_generation';
      const selectedRoute = {
        status: 'selected',
        provider_id: String(target.provider_id || ''),
        account_id: String(target.account_id || ''),
        model_id: String(target.model_id || ''),
        capability
      };
      if (!selectedRoute.provider_id || !selectedRoute.account_id || !selectedRoute.model_id) {
        return { status: 'blocked', reason: 'model_route_incomplete' };
      }
      const result = await executionEngine.execute({
        execution_version: '1',
        request_id: `${missionId || 'mission'}:${step.id || 'step'}`,
        task_id: step.id || null,
        capability,
        selected_route: selectedRoute,
        authorization,
        input: step.input && typeof step.input === 'object' ? step.input : {},
        policy: policy && typeof policy === 'object' ? policy : {},
        metadata: { mission_id: missionId || null, step_id: step.id || null, executor_type: 'model' }
      });
      return {
        ...result,
        model_execution: true,
        provider_id: selectedRoute.provider_id,
        account_id: selectedRoute.account_id,
        model_id: selectedRoute.model_id
      };
    }
  });
}

function createAdapterRegistry({ activation, deviceDispatcher, agentExecutors = {}, modelExecution = canonicalExecution } = {}) {
  const adapters = {
    connector: createConnectorAdapter({ activation }),
    device: createDeviceAdapter({ deviceDispatcher }),
    agent: createAgentAdapter({ agentExecutors }),
    model: createModelAdapter({ executionEngine: modelExecution })
  };

  function get(executorType) {
    return adapters[executorType] || null;
  }

  function list() {
    return Object.values(adapters).map(({ adapter_id, executor_type, status, operations }) => ({
      adapter_id,
      executor_type,
      status,
      operations: operations || ['*']
    }));
  }

  return Object.freeze({ get, list });
}

module.exports = Object.freeze({ createAdapterRegistry, createModelAdapter });
