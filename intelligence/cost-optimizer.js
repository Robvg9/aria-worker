'use strict';

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function score01(value, fallback = 0) {
  const number = finiteNonNegative(value);
  return number === null ? fallback : Math.max(0, Math.min(1, number));
}

function hasVerifiedCostEvidence(candidate = {}) {
  const evidence = candidate.cost_evidence;
  return Boolean(
    evidence &&
    typeof evidence === 'object' &&
    !Array.isArray(evidence) &&
    evidence.observed === true &&
    evidence.verified === true &&
    typeof evidence.source_id === 'string' &&
    evidence.source_id.trim()
  );
}

function verifiedUnitCost(candidate = {}) {
  const price = finiteNonNegative(candidate.usd_per_1k);
  return price !== null && hasVerifiedCostEvidence(candidate) ? price : null;
}

function normalizeCandidate(candidate = {}) {
  const cost = verifiedUnitCost(candidate);
  const latency = finiteNonNegative(candidate.latency_ms);
  return {
    ...candidate,
    quality: score01(candidate.quality),
    reliability: score01(candidate.reliability),
    latency_ms: latency !== null && latency > 0 ? latency : null,
    // NULL means unknown. It is never coerced to the price of a free model.
    usd_per_1k: cost,
    cost_status: cost === null ? 'unknown' : cost === 0 ? 'verified_free' : 'verified',
  };
}

function normalizedWeight(value, fallback) {
  return finiteNonNegative(value) === null ? fallback : Math.max(0, Math.min(1, Number(value)));
}

function utility(candidate, options = {}) {
  const x = normalizeCandidate(candidate);
  const qualityWeight = normalizedWeight(options.qualityWeight, 0.45);
  const reliabilityWeight = normalizedWeight(options.reliabilityWeight, 0.30);
  const latencyWeight = normalizedWeight(options.latencyWeight, 0.10);
  const costWeight = normalizedWeight(options.costWeight, 0.15);
  const latency = x.latency_ms === null ? 0 : 1 / (1 + x.latency_ms / 1000);
  // Unknown prices receive no cost-efficiency credit; only observed and
  // verified unit prices (including a verified zero) can earn that signal.
  const cost = x.usd_per_1k === null ? 0 : 1 / (1 + x.usd_per_1k);
  return Number((
    x.quality * qualityWeight +
    x.reliability * reliabilityWeight +
    latency * latencyWeight +
    cost * costWeight
  ).toFixed(6));
}

function optimize(candidates = [], options = {}) {
  if (!Array.isArray(candidates)) return null;
  const requireKnownCost = options.require_known_cost === true;
  const ranked = candidates.map(candidate => {
    const normalized = normalizeCandidate(candidate);
    return { ...normalized, utility: utility(candidate, options) };
  }).filter(candidate => !requireKnownCost || candidate.usd_per_1k !== null);

  ranked.sort((a, b) => {
    const scoreOrder = b.utility - a.utility;
    if (scoreOrder) return scoreOrder;
    if (a.usd_per_1k === null && b.usd_per_1k !== null) return 1;
    if (b.usd_per_1k === null && a.usd_per_1k !== null) return -1;
    if (a.usd_per_1k !== null && b.usd_per_1k !== null && a.usd_per_1k !== b.usd_per_1k) {
      return a.usd_per_1k - b.usd_per_1k;
    }
    return String(a.model_id || '').localeCompare(String(b.model_id || ''));
  });
  return ranked[0] || null;
}

module.exports = { finiteNonNegative, hasVerifiedCostEvidence, verifiedUnitCost, normalizeCandidate, utility, optimize };
