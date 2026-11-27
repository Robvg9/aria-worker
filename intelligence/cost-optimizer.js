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

function verifiedUnitCost(candidate = {}) {
  const price = finiteNonNegative(candidate.usd_per_1k);
  const evidence = candidate.cost_evidence;
  if (price === null || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  if (evidence.observed !== true || evidence.verified !== true) return null;
  if (typeof evidence.source_id !== 'string' || !evidence.source_id.trim()) return null;
  return price;
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

  ranked.sort((a, b) =>
    b.utility - a.utility ||
    (a.usd_per_1k === null ? 1 : b.usd_per_1k === null ? -1 : a.usd_per_1k - b.usd_per_1k) ||
    String(a.model_id || '').localeCompare(String(b.model_id || ''))
  );
  return ranked[0] || null;
}

module.exports = { finiteNonNegative, verifiedUnitCost, normalizeCandidate, utility, optimize };
