/**
 * ARIA Resource / Cost Intelligence 1.0
 * Pure, deterministic, secret-free economic decision engine.
 */
const registry = {
  version: 'resource-intelligence-v1'
};

const COMPLEXITY = {
  low: { baseInput: 250, baseOutput: 120, minQuality: 0.60 },
  medium: { baseInput: 700, baseOutput: 350, minQuality: 0.72 },
  high: { baseInput: 1600, baseOutput: 800, minQuality: 0.84 },
  critical: { baseInput: 3200, baseOutput: 1500, minQuality: 0.92 }
};

const clamp01 = n => Math.max(0, Math.min(1, n));

function complexityFor(task, explicit) {
  if (explicit && COMPLEXITY[explicit]) return explicit;
  const text = String(task || '').toLowerCase();
  if (/(critical|production|security|migration|irreversible|destructive)/.test(text)) return 'critical';
  if (/(complex|architecture|multi-step|research|code|debug|analysis)/.test(text)) return 'high';
  if (/(write|transform|summarize|classify|extract)/.test(text)) return 'medium';
  return 'low';
}

function estimateTokens(task, complexity, hints = {}) {
  const profile = COMPLEXITY[complexity];
  const words = String(task || '').trim().split(/\s+/).filter(Boolean).length;
  const multiplier = Math.max(0.8, Math.min(2.0, 1 + words / 250));
  return {
    input: Number.isFinite(hints.input_tokens) ? Math.max(1, Math.round(hints.input_tokens)) : Math.round(profile.baseInput * multiplier),
    output: Number.isFinite(hints.output_tokens) ? Math.max(1, Math.round(hints.output_tokens)) : Math.round(profile.baseOutput * multiplier),
    total: undefined
  };
}

function validCandidate(c) {
  return c && typeof c === 'object' &&
    typeof c.provider_id === 'string' && c.provider_id &&
    typeof c.account_id === 'string' && c.account_id &&
    typeof c.model_id === 'string' && c.model_id &&
    Number.isFinite(c.quality_score) && c.quality_score >= 0 && c.quality_score <= 1 &&
    Number.isFinite(c.cost_per_1k_input_usd) && c.cost_per_1k_input_usd >= 0 &&
    Number.isFinite(c.cost_per_1k_output_usd) && c.cost_per_1k_output_usd >= 0 &&
    Number.isFinite(c.latency_ms) && c.latency_ms > 0 &&
    Number.isFinite(c.risk_score) && c.risk_score >= 0 && c.risk_score <= 1 &&
    (!('compute_units' in c) || (Number.isFinite(c.compute_units) && c.compute_units >= 0));
}

function candidateEstimate(candidate, tokens) {
  const inputCost = (tokens.input / 1000) * candidate.cost_per_1k_input_usd;
  const outputCost = (tokens.output / 1000) * candidate.cost_per_1k_output_usd;
  return {
    cost_usd: Number((inputCost + outputCost).toFixed(8)),
    latency_ms: Math.round(candidate.latency_ms),
    compute_units: Number.isFinite(candidate.compute_units) ? candidate.compute_units : null
  };
}

function meetsRequirements(candidate, requirements = {}) {
  if (requirements.capability) {
    if (!Array.isArray(candidate.capabilities) || !candidate.capabilities.includes(requirements.capability)) return false;
  }
  if (requirements.provider_id && candidate.provider_id !== requirements.provider_id) return false;
  if (requirements.model_id && candidate.model_id !== requirements.model_id) return false;
  return true;
}

function utility(candidate, estimate, context) {
  const quality = clamp01(candidate.quality_score);
  const qualityGap = Math.max(0, quality - context.minQuality);
  const qualityBonus = Math.min(0.25, qualityGap * 0.8);
  const costTerm = Math.max(0, 1 - Math.min(1, estimate.cost_usd / context.costScale));
  const latencyTerm = Math.max(0, 1 - Math.min(1, estimate.latency_ms / context.latencyScale));
  const riskTerm = 1 - clamp01(candidate.risk_score);
  return Number((0.40 * costTerm + 0.20 * latencyTerm + 0.25 * riskTerm + 0.15 * (quality + qualityBonus)).toFixed(8));
}

function compare(a, b) {
  return b.utility - a.utility || a.estimate.cost_usd - b.estimate.cost_usd ||
    a.candidate.risk_score - b.candidate.risk_score ||
    a.candidate.latency_ms - b.candidate.latency_ms ||
    a.candidate.provider_id.localeCompare(b.candidate.provider_id) ||
    a.candidate.account_id.localeCompare(b.candidate.account_id) ||
    a.candidate.model_id.localeCompare(b.candidate.model_id);
}

function decide(input) {
  if (!input || typeof input !== 'object' || typeof input.task !== 'string' || !input.task.trim()) {
    return { status: 'insufficient_evidence', reason: 'invalid_task' };
  }
  const complexity = complexityFor(input.task, input.complexity);
  const profile = COMPLEXITY[complexity];
  const tokens = estimateTokens(input.task, complexity, input.token_hints);
  tokens.total = tokens.input + tokens.output;
  const requirements = input.requirements || {};
  const riskTolerance = Number.isFinite(input.risk_tolerance) ? clamp01(input.risk_tolerance) : 0.35;
  const maxCost = Number.isFinite(input.max_cost_usd) ? Math.max(0, input.max_cost_usd) : Infinity;
  const maxTokens = Number.isFinite(input.max_tokens) ? Math.max(0, input.max_tokens) : Infinity;
  const maxLatency = Number.isFinite(input.max_latency_ms) ? Math.max(0, input.max_latency_ms) : Infinity;
  const expectedValue = Number.isFinite(input.expected_value) ? Math.max(0, input.expected_value) : 1;
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const rejected = [];
  const eligible = [];

  if (tokens.total > maxTokens) return { status: 'no_resource', reason: 'token_budget_exceeded', complexity, estimated_tokens: tokens.total };

  for (const candidate of candidates) {
    if (!validCandidate(candidate)) {
      rejected.push({ model_id: candidate?.model_id || 'unknown', reason: 'invalid_candidate' });
      continue;
    }
    if (!meetsRequirements(candidate, requirements)) {
      rejected.push({ model_id: candidate.model_id, reason: 'requirements_mismatch' });
      continue;
    }
    if (candidate.quality_score < profile.minQuality) {
      rejected.push({ model_id: candidate.model_id, reason: 'quality_below_threshold' });
      continue;
    }
    if (candidate.risk_score > riskTolerance) {
      rejected.push({ model_id: candidate.model_id, reason: 'risk_above_tolerance' });
      continue;
    }
    const estimate = candidateEstimate(candidate, tokens);
    if (estimate.cost_usd > maxCost) {
      rejected.push({ model_id: candidate.model_id, reason: 'cost_budget_exceeded', cost_usd: estimate.cost_usd });
      continue;
    }
    if (estimate.latency_ms > maxLatency) {
      rejected.push({ model_id: candidate.model_id, reason: 'latency_budget_exceeded', latency_ms: estimate.latency_ms });
      continue;
    }
    const costScale = Number.isFinite(maxCost) && maxCost > 0 ? maxCost : Math.max(estimate.cost_usd, 0.01);
    const latencyScale = Number.isFinite(maxLatency) && maxLatency > 0 ? maxLatency : Math.max(estimate.latency_ms, 1);
    const item = {
      candidate,
      estimate,
      utility: utility(candidate, estimate, { minQuality: profile.minQuality, costScale, latencyScale }),
      expected_value: expectedValue * clamp01(candidate.quality_score),
    };
    eligible.push(item);
  }

  if (!eligible.length) return { status: 'no_resource', reason: 'no_eligible_candidate', complexity, estimated_tokens: tokens.total, rejected };
  eligible.sort(compare);
  const winner = eligible[0];
  const sufficient = winner.candidate.quality_score >= profile.minQuality;
  if (!sufficient) return { status: 'no_resource', reason: 'insufficient_quality', complexity, estimated_tokens: tokens.total, rejected };

  return {
    status: 'selected',
    complexity,
    requirements,
    models_needed: [winner.candidate.model_id],
    estimated_tokens: tokens,
    estimated_latency_ms: winner.estimate.latency_ms,
    estimated_cost_usd: winner.estimate.cost_usd,
    estimated_compute_units: winner.estimate.compute_units,
    risk_score: winner.candidate.risk_score,
    expected_value: Number(winner.expected_value.toFixed(8)),
    utility: winner.utility,
    selection_reason: 'sufficient_quality_at_lowest_governed_economic_risk',
    selected: {
      provider_id: winner.candidate.provider_id,
      account_id: winner.candidate.account_id,
      model_id: winner.candidate.model_id,
    },
    candidates_considered: eligible.length,
    rejected_candidates: rejected,
    unknown_dimensions: candidates.filter(c => c && (!Number.isFinite(c.compute_units))).map(c => `${c.model_id || 'unknown'}:compute_units`),
  };
}

module.exports = { version: registry.version, decide, complexityFor, estimateTokens, validCandidate, candidateEstimate, utility };
