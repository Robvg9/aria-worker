'use strict';
const { TYPES } = require('./registry');
function validateExtensionContract(item = {}) {
  if (!item || typeof item.id !== 'string' || !item.id) return { valid:false, reason:'invalid_id' };
  if (!TYPES.has(item.type)) return { valid:false, reason:'invalid_type' };
  if (typeof item.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(item.version)) return { valid:false, reason:'invalid_version' };
  if (item.entrypoint !== undefined && typeof item.entrypoint !== 'string') return { valid:false, reason:'invalid_entrypoint' };
  if (item.permissions !== undefined && (!Array.isArray(item.permissions) || item.permissions.some(x => typeof x !== 'string'))) return { valid:false, reason:'invalid_permissions' };
  return { valid:true, reason:'contract_valid' };
}
module.exports = { validateExtensionContract };