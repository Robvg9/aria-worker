'use strict';

const { listConnectors } = require('./registry');

function createConnectorRuntime({ adapters = {}, probes = {} } = {}) {
  async function inspect(connector_id) {
    const descriptor = listConnectors().find((x) => x.connector_id === connector_id);
    if (!descriptor) return null;
    const adapter = adapters[connector_id] || null;
    const probe = probes[connector_id] || null;
    let availability = 'unknown';
    if (typeof probe === 'function') {
      try {
        const result = await probe();
        if (result && ['available','unavailable','unknown'].includes(result.status)) availability = result.status;
      } catch (_) { availability = 'unknown'; }
    } else if (adapter) {
      availability = 'configured';
    }
    return Object.freeze({
      connector_id,
      name: descriptor.name,
      operations: [...descriptor.operations],
      adapter_present: !!adapter,
      availability
    });
  }

  async function inspectAll() {
    const out = [];
    for (const c of listConnectors()) out.push(await inspect(c.connector_id));
    return out;
  }

  return Object.freeze({ inspect, inspectAll });
}

module.exports = { createConnectorRuntime };
