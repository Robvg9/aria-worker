/**
 * ARIA Tool Registry lookup helpers (declarative)
 * Mission 10.9 — pure functions, no side effects, no secrets, no execution.
 */
const registry = require('./registry.json');

const AVAILABLE = 'available';

function getTool(toolId) {
  if (!toolId || typeof toolId !== 'string') return null;
  return registry.tools.find(t => t.tool_id === toolId) || null;
}

function getToolByMcpName(mcpName) {
  if (!mcpName || typeof mcpName !== 'string') return null;
  const id = registry.indexes && registry.indexes.by_mcp_name
    ? registry.indexes.by_mcp_name[mcpName]
    : null;
  return id ? getTool(id) : null;
}

function listTools() {
  return registry.tools.slice();
}

function listToolIds() {
  return registry.tools.map(t => t.tool_id);
}

function toolsByProvider(providerId) {
  if (!providerId || typeof providerId !== 'string') return [];
  return registry.tools.filter(t => t.provider_id === providerId);
}

function toolsByRisk(riskLevel) {
  if (!riskLevel || typeof riskLevel !== 'string') return [];
  return registry.tools.filter(t => t.risk_level === riskLevel);
}

function isAvailable(toolId) {
  const t = getTool(toolId);
  if (!t) return false;
  return t.status === AVAILABLE;
}

function isStatusAvailable(tool) {
  if (!tool || typeof tool !== 'object') return false;
  return tool.status === AVAILABLE;
}

function supportsOperation(toolId, operation) {
  const t = getTool(toolId);
  if (!t || !Array.isArray(t.operations)) return false;
  return t.operations.indexOf(operation) !== -1;
}

function riskOf(toolId) {
  const t = getTool(toolId);
  return t ? t.risk_level : null;
}

module.exports = {
  version: registry.version,
  getTool,
  getToolByMcpName,
  listTools,
  listToolIds,
  toolsByProvider,
  toolsByRisk,
  isAvailable,
  isStatusAvailable,
  supportsOperation,
  riskOf,
  registry
};
