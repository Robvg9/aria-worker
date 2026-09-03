'use strict';

function createScope({ capabilities = [], tools = [], operations = [], max_risk = 'low' } = {}) {
  const risks = { low: 0, medium: 1, high: 2, destructive: 3 };
  if (!Object.prototype.hasOwnProperty.call(risks, max_risk)) throw new Error('invalid max_risk');
  return Object.freeze({
    capabilities: [...new Set(capabilities)],
    tools: [...new Set(tools)],
    operations: [...new Set(operations)],
    max_risk
  });
}

function scopeAllows(scope, request = {}) {
  if (!scope || !request) return false;
  const risks = { low: 0, medium: 1, high: 2, destructive: 3 };
  if (!Object.prototype.hasOwnProperty.call(risks, request.risk)) return false;
  if (risks[request.risk] > risks[scope.max_risk]) return false;
  if (request.capability && !scope.capabilities.includes(request.capability)) return false;
  if (request.tool && scope.tools.length && !scope.tools.includes(request.tool)) return false;
  if (request.operation && scope.operations.length && !scope.operations.includes(request.operation)) return false;
  return true;
}

module.exports = { createScope, scopeAllows };