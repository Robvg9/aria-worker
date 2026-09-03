'use strict';

const CONNECTOR_STATES = Object.freeze(['unconfigured','configured','healthy','degraded','unavailable','disabled']);
const RISK_CLASSES = Object.freeze(['READ','LOW_RISK_WRITE','HIGH_RISK_WRITE','DESTRUCTIVE']);
const TRUSTED_BASE_URLS = Object.freeze({
  github:'https://api.github.com',
  supabase:'https://api.supabase.com',
  cloudflare:'https://api.cloudflare.com/client/v4',
  notion:'https://api.notion.com/v1'
});

function isSecretRef(value) { return typeof value === 'string' && /^secret:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value.trim()); }
function validateConnectorConfig(config) {
  if (!config || typeof config !== 'object') return { valid:false, reason:'config_missing' };
  if (typeof config.connector_id !== 'string' || !config.connector_id) return { valid:false, reason:'connector_id_missing' };
  if (typeof config.enabled !== 'boolean') return { valid:false, reason:'enabled_missing' };
  if (config.credential_ref != null && !isSecretRef(config.credential_ref)) return { valid:false, reason:'credential_ref_invalid' };
  const trusted = TRUSTED_BASE_URLS[config.connector_id];
  if (trusted && config.base_url !== trusted) return { valid:false, reason:'provider_origin_not_trusted' };
  return { valid:true, reason:null };
}
function normalizeState(value) { return CONNECTOR_STATES.includes(value) ? value : 'unconfigured'; }

module.exports = { CONNECTOR_STATES, RISK_CLASSES, TRUSTED_BASE_URLS, isSecretRef, validateConnectorConfig, normalizeState };
