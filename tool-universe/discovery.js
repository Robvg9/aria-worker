'use strict';

function cloneTool(tool) { return structuredClone(tool); }

function createToolDiscovery({ registry } = {}) {
  if (!registry || typeof registry.list !== 'function') throw new TypeError('registry is required');
  function discover({ capability = null, operation = null, interface_type = null, include_unknown = false } = {}) {
    return registry.list()
      .filter((tool) => {
        if (!include_unknown && tool.status !== 'available') return false;
        if (capability && !(tool.capabilities || []).includes(capability)) return false;
        if (operation && !(tool.operations || []).includes(operation)) return false;
        if (interface_type && tool.interface_type !== interface_type) return false;
        return true;
      })
      .map(cloneTool);
  }
  return Object.freeze({ discover });
}

module.exports = { createToolDiscovery };
