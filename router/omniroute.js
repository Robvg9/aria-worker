'use strict';

/** ARIA Router — OmniRoute Phase 7 opt-in integration. */
const PROVIDER_ID = 'omniroute';
const CAPABILITY_ID = 'text_generation';
const CAPABILITY = 'omniroute.gateway';
const ROUTE_TYPE = 'omniroute_opt_in';
const VERSION = 'aria-omniroute-router-integration-v1.0.0';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLoopbackEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') &&
      url.pathname.endsWith('/chat/completions');
  } catch { return false; }
}

function verifiedEvidence(evidence, endpoint) {
  if (!isRecord(evidence)) return false;
  return evidence.status === 'verified' &&
    evidence.healthy === true &&
    evidence.capability === CAPABILITY &&
    evidence.source === 'aria.omniroute.capability' &&
    typeof evidence.evidence_id === 'string' && evidence.evidence_id.trim() !== '' &&
    typeof evidence.verified_at === 'string' && evidence.verified_at.trim() !== '' &&
    evidence.endpoint === endpoint;
}

function noRoute(reason) { return { status: 'no_route', reason, version: VERSION }; }

function selectOptIn(input) {
  if (!isRecord(input)) return noRoute('input_missing');
  if (input.opt_in !== true) return noRoute('opt_in_required');
  if (input.provider_id !== PROVIDER_ID) return noRoute('provider_not_omniroute');
  if (input.capability !== CAPABILITY_ID) return noRoute('capability_not_supported');
  const modelId = typeof input.model_id === 'string' ? input.model_id.trim() : '';
  const accountId = typeof input.account_id === 'string' ? input.account_id.trim() : '';
  const endpoint = typeof input.gateway_endpoint === 'string' ? input.gateway_endpoint.trim() : '';
  if (!modelId) return noRoute('model_required');
  if (!accountId) return noRoute('account_required');
  if (!isLoopbackEndpoint(endpoint)) return noRoute('loopback_endpoint_required');
  if (!verifiedEvidence(input.availability_evidence, endpoint)) return noRoute('availability_evidence_required');
  return {
    status: 'selected', provider_id: PROVIDER_ID, account_id: accountId, model_id: modelId, capability: CAPABILITY_ID,
    route_type: ROUTE_TYPE, gateway_endpoint: endpoint,
    omniroute_provider: typeof input.omniroute_provider === 'string' && input.omniroute_provider.trim() ? input.omniroute_provider.trim() : null,
    selection_evidence: { source: 'aria.omniroute.capability', capability: CAPABILITY, evidence_id: input.availability_evidence.evidence_id, verified_at: input.availability_evidence.verified_at, endpoint },
    version: VERSION
  };
}

module.exports = { VERSION, PROVIDER_ID, CAPABILITY_ID, CAPABILITY, ROUTE_TYPE, isLoopbackEndpoint, verifiedEvidence, selectOptIn };