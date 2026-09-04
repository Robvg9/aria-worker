'use strict';

const { createConnectorAdapter } = require('./connector');
const { createDeviceAdapter } = require('./device');
const { createAgentAdapter } = require('./agent');

function createAdapterRegistry({ activation, deviceDispatcher, agentExecutors = {} } = {}) {
  const adapters = {
    connector: createConnectorAdapter({ activation }),
    device: createDeviceAdapter({ deviceDispatcher }),
    agent: createAgentAdapter({ agentExecutors })
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

module.exports = Object.freeze({ createAdapterRegistry });
