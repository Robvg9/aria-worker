'use strict';

function createConnectorManager({ registry, probes = {} } = {}) {
  if (!registry || typeof registry.get !== 'function' || typeof registry.register !== 'function') throw new TypeError('registry is required');
  const probe = async (tool) => {
    const fn = probes[tool.interface_type] || probes.default;
    if (typeof fn !== 'function') return { status: 'unknown', reason: 'probe_unavailable' };
    const result = await fn(structuredClone(tool));
    if (!result || !['available','unavailable','unknown'].includes(result.status)) return { status: 'unknown', reason: 'invalid_probe_result' };
    return { ...result };
  };
  async function inspect(toolId) { const tool = registry.get(toolId); if (!tool) return null; return Object.freeze({ tool, probe: await probe(tool) }); }
  async function syncStatus(toolId) { const state = await inspect(toolId); if (!state) throw new Error('tool_not_found'); return registry.updateStatus(toolId, state.probe.status); }
  return Object.freeze({ inspect, syncStatus });
}

module.exports = { createConnectorManager };
