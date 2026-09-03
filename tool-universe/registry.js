'use strict';

const VALID_STATUS = new Set(['available','unavailable','unknown']);
const VALID_RISK = new Set(['read','low_risk_write','high_risk_write','destructive','unknown']);

function cloneTool(tool) { return structuredClone(tool); }

function validateTool(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new TypeError('tool must be an object');
  const required = ['tool_id','name','interface_type','operations','risk_level','status'];
  for (const key of required) if (typeof tool[key] !== 'string' && key !== 'operations') throw new TypeError(`invalid ${key}`);
  if (!Array.isArray(tool.operations)) throw new TypeError('operations must be an array');
  if (!VALID_STATUS.has(tool.status) || !VALID_RISK.has(tool.risk_level)) throw new TypeError('invalid status/risk');
  if (tool.permission_refs !== undefined && !Array.isArray(tool.permission_refs)) throw new TypeError('permission_refs must be an array');
  return true;
}

function createToolRegistry(initialTools = []) {
  const map = new Map();
  for (const tool of initialTools) { validateTool(tool); if (map.has(tool.tool_id)) throw new Error('duplicate_tool_id'); map.set(tool.tool_id, cloneTool(tool)); }
  const list = () => [...map.values()].map(cloneTool);
  const get = (id) => id && map.has(id) ? cloneTool(map.get(id)) : null;
  const register = (tool) => { validateTool(tool); if (map.has(tool.tool_id)) throw new Error('tool_exists'); map.set(tool.tool_id, cloneTool(tool)); return cloneTool(tool); };
  const updateStatus = (id, status) => { if (!VALID_STATUS.has(status)) throw new TypeError('invalid status'); const t = map.get(id); if (!t) throw new Error('tool_not_found'); t.status = status; return cloneTool(t); };
  const remove = (id) => map.delete(id);
  return Object.freeze({ list, get, register, updateStatus, remove, has: (id) => map.has(id), statuses: [...VALID_STATUS], risks: [...VALID_RISK] });
}

module.exports = { createToolRegistry, validateTool, VALID_STATUS: [...VALID_STATUS], VALID_RISK: [...VALID_RISK] };
