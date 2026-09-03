'use strict';

const { isSecretRef } = require('./contract');

const DEFAULT_MANIFEST = Object.freeze([
  { connector_id:'github', credential_ref:'secret://github/default', base_url:'https://api.github.com', enabled:false, required:false },
  { connector_id:'supabase', credential_ref:'secret://supabase/default', base_url:'https://api.supabase.com', enabled:false, required:false },
  { connector_id:'cloudflare', credential_ref:'secret://cloudflare/default', base_url:'https://api.cloudflare.com/client/v4', enabled:false, required:false },
  { connector_id:'notion', credential_ref:'secret://notion/default', base_url:'https://api.notion.com/v1', enabled:false, required:false },
  { connector_id:'web', credential_ref:null, base_url:null, enabled:true, required:false },
  { connector_id:'image', credential_ref:null, base_url:null, enabled:true, required:false },
  { connector_id:'filesystem', credential_ref:null, base_url:null, enabled:true, required:false }
]);

function normalizeManifest(input = DEFAULT_MANIFEST) {
  if (!Array.isArray(input)) throw new Error('manifest_array_required');
  return input.map(entry => {
    const out = { ...entry };
    out.enabled = out.enabled === true;
    if (out.credential_ref !== null && !isSecretRef(out.credential_ref)) throw new Error(`credential_ref_invalid:${out.connector_id || 'unknown'}`);
    return Object.freeze(out);
  });
}

function activationSummary(manifest) {
  const normalized = normalizeManifest(manifest);
  return normalized.map(({ connector_id, enabled, required }) => ({ connector_id, enabled, required }));
}

module.exports = { DEFAULT_MANIFEST, normalizeManifest, activationSummary };
