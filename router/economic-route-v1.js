/**
 * ARIA Router Economic Overlay v1.
 * Keeps classic route() compatibility while adding governed economic selection.
 */
const router = require('./lookup.js');
const economics = require('../resource-intelligence/engine.js');

function economicallySelect(input) {
  if (!input || typeof input !== 'object') return { status: 'insufficient_evidence', reason: 'invalid_input' };
  const base = typeof input.capability === 'string' ? router.route({
    capability: input.capability,
    preferred_model: input.preferred_model,
    preferred_provider: input.preferred_provider,
    preferred_account: input.preferred_account,
  }) : { status: 'no_route' };

  const candidates = Array.isArray(input.economic_candidates) ? input.economic_candidates : [];
  const decision = economics.decide({
    task: input.task,
    complexity: input.complexity,
    requirements: {
      capability: input.capability,
      provider_id: input.preferred_provider,
      model_id: input.preferred_model,
    },
    token_hints: input.token_hints,
    max_cost_usd: input.max_cost_usd,
    max_tokens: input.max_tokens,
    max_latency_ms: input.max_latency_ms,
    risk_tolerance: input.risk_tolerance,
    expected_value: input.expected_value,
    candidates,
  });

  return {
    ...decision,
    base_route: base,
    router_version: router.version,
    economic_overlay_version: economics.version,
  };
}

module.exports = { economicallySelect, version: 'router-economic-overlay-v1' };
