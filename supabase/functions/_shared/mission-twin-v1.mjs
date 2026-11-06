/**
 * ARIA Mission Twin v1 — deterministic, read-only preflight.
 *
 * This module simulates a candidate from existing evidence. It never executes
 * missions, authorizes mutations, or upgrades unknown evidence to PASS.
 */
const INTERVAL_MINUTES = Object.freeze({ min: 5, default: 10, max: 60 });
const MAX_CANDIDATES = 25;
const SENSITIVE = /\b(production|prod|deploy|deployment|merge|main|master|secret|credential|token|api[_ -]?key|password|payment|billing|purchase|delete|destroy|destructive|permission|access control|migration|drop table|erase|eliminar|borrar|credencial|secreto|pagar|producci[oó]n)\b/i;
const ACTION = /\b(implement|modify|update|add|remove|delete|deploy|merge|migrate|repair|change|write|create|fix|refactor|build|implementar|modificar|actualizar|añadir|anadir|eliminar|desplegar|migrar|reparar|corregir|crear)\b/i;
const text = (v) => typeof v === 'string' ? v.trim() : '';
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : min));

function missionTwinSlot(now = new Date(), intervalMinutes = INTERVAL_MINUTES.default) {
  const interval = Number(intervalMinutes);
  if (!Number.isInteger(interval) || interval < INTERVAL_MINUTES.min || interval > INTERVAL_MINUTES.max) {
    throw new RangeError('mission_twin_interval_out_of_bounds');
  }
  const time = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(time)) throw new TypeError('mission_twin_invalid_clock');
  const intervalMs = interval * 60_000;
  const start = Math.floor(time / intervalMs) * intervalMs;
  return new Date(start).toISOString();
}

function missionTwinCycleId(now = new Date(), intervalMinutes = INTERVAL_MINUTES.default) {
  return 'mission-twin-' + missionTwinSlot(now, intervalMinutes).replace(/[:.]/g, '-');
}

function missionTwinLeaseDecision({ status, evidence = {}, now = new Date() } = {}) {
  const currentStatus = text(status);
  const time = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(time)) throw new TypeError('mission_twin_invalid_clock');
  if (!currentStatus) return Object.freeze({ action: 'claim', reason: 'slot_unclaimed' });
  if (currentStatus === 'completed') return Object.freeze({ action: 'skip', reason: 'slot_already_completed' });
  if (currentStatus !== 'started') return Object.freeze({ action: 'skip', reason: 'slot_already_recorded' });
  const record = evidence && typeof evidence === 'object' ? evidence : {};
  const owner = text(record.lease_owner);
  const leaseUntil = text(record.lease_until);
  const expiry = leaseUntil ? Date.parse(leaseUntil) : NaN;
  // Fail closed: only a well-formed, explicitly expired lease can be reclaimed.
  // Missing/invalid expiry is not proof that the previous owner has relinquished the slot.
  if (!leaseUntil || !Number.isFinite(expiry)) {
    return Object.freeze({ action: 'skip', reason: 'invalid_lease_expiry_not_reclaimed' });
  }
  if (expiry > time) {
    return Object.freeze({ action: 'busy', reason: 'active_lease', lease_until: new Date(expiry).toISOString() });
  }
  if (!owner) return Object.freeze({ action: 'skip', reason: 'stale_claim_without_owner_not_reclaimed' });
  return Object.freeze({ action: 'reclaim', reason: 'lease_expired', expected_owner: owner });
}

function buildMissionTwinReport({ snapshot = {}, candidates = [], now = new Date(), intervalMinutes = INTERVAL_MINUTES.default } = {}) {
  const generatedAt = new Date(now instanceof Date ? now.getTime() : now).toISOString();
  const slot = missionTwinSlot(generatedAt, intervalMinutes);
  const goals = Array.isArray(snapshot.goals) ? snapshot.goals : [];
  const active = Array.isArray(snapshot.active) ? snapshot.active : [];
  const failures = Array.isArray(snapshot.failures) ? snapshot.failures : [];
  const gaps = Array.isArray(snapshot.capabilityGaps) ? snapshot.capabilityGaps : [];
  const learnings = Array.isArray(snapshot.learnings) ? snapshot.learnings : [];
  const candidateList = Array.isArray(candidates) ? candidates.filter((c) => c && text(c.goal_id) && text(c.goal)) : [];
  const sorted = [...candidateList].sort((a, b) =>
    Number(b.dynamic_score || 0) - Number(a.dynamic_score || 0) || text(a.goal_id).localeCompare(text(b.goal_id))
  ).slice(0, MAX_CANDIDATES);
  const selected = sorted[0] || null;
  const declared = selected ? goals.find((g) => text(g.goal_id) === text(selected.goal_id)) : null;
  const metadata = declared && declared.metadata && typeof declared.metadata === 'object' ? declared.metadata : {};
  const prerequisites = Array.isArray(metadata.prerequisites) ? metadata.prerequisites.map(text).filter(Boolean) :
    Array.isArray(metadata.dependencies) ? metadata.dependencies.map(text).filter(Boolean) : [];
  const knownGoalIds = new Set(goals.map((g) => text(g.goal_id)).filter(Boolean));
  const missingPrerequisites = prerequisites.filter((id) => !knownGoalIds.has(id));
  const goalText = selected ? text(selected.goal) : '';
  const sensitive = selected ? SENSITIVE.test(goalText) : false;
  const mutationLike = selected ? ACTION.test(goalText) : false;
  const sourceEvidence = {
    snapshot_counts: {
      goals: goals.length,
      active_missions: active.length,
      recent_failures: failures.length,
      capability_gaps: gaps.length,
      recent_learnings: learnings.length
    },
    candidate_count: sorted.length,
    selected_goal_id: selected ? text(selected.goal_id) : null,
    selected_source_type: selected ? text(selected.source_type) || 'unknown' : null,
    selected_score: selected && Number.isFinite(Number(selected.dynamic_score)) ? Number(selected.dynamic_score) : null,
    declared_prerequisites: prerequisites,
    missing_prerequisites: missingPrerequisites
  };
  let recommendation = 'NO_ACTION';
  let reason = 'no_candidate_with_evidence';
  let risk = 'none';
  if (selected) {
    risk = sensitive ? 'elevated' : mutationLike ? 'unknown' : 'unknown';
    if (sensitive) {
      recommendation = 'APPROVAL_REQUIRED';
      reason = 'sensitive_scope_detected';
    } else if (missingPrerequisites.length > 0) {
      recommendation = 'DEFER';
      reason = 'declared_prerequisites_missing';
    } else {
      recommendation = 'RECOMMEND_ONLY';
      reason = 'simulation_is_not_execution_authority';
    }
  }
  return Object.freeze({
    version: 'mission-twin-v1',
    status: 'SIMULATED',
    generated_at: generatedAt,
    slot,
    interval_minutes: Number(intervalMinutes),
    recommendation,
    reason,
    risk,
    mutation_like: mutationLike,
    sensitive_scope_detected: sensitive,
    simulation_only: true,
    live_verified: false,
    execution_authorized: false,
    candidate: selected ? Object.freeze({
      goal_id: text(selected.goal_id),
      goal: goalText.slice(0, 500),
      source_type: text(selected.source_type) || 'unknown',
      score: Number.isFinite(Number(selected.dynamic_score)) ? Number(selected.dynamic_score) : null
    }) : null,
    alternatives: Object.freeze(sorted.slice(1, 4).map((c) => Object.freeze({
      goal_id: text(c.goal_id), score: Number.isFinite(Number(c.dynamic_score)) ? Number(c.dynamic_score) : null
    }))),
    dependency_graph: Object.freeze({ selected_goal_id: selected ? text(selected.goal_id) : null, prerequisites: Object.freeze(prerequisites) }),
    predicted_blockers: Object.freeze(missingPrerequisites.map((id) => Object.freeze({ code: 'MISSING_PREREQUISITE', ref: id, confidence: 1 }))),
    shared_blockers: Object.freeze({
      active_missions: active.length,
      recent_failures: failures.length,
      unresolved_capability_gaps: gaps.length
    }),
    resource_budget: Object.freeze({ max_candidates_considered: sorted.length, max_candidate_limit: MAX_CANDIDATES, max_selected_candidates: 1, execution_budget: 0 }),
    rollback: Object.freeze({ required_before_any_mutation: true, plan: 'No mutation performed by Mission Twin v1.' }),
    evidence: Object.freeze(sourceEvidence)
  });
}

export { INTERVAL_MINUTES, MAX_CANDIDATES, missionTwinSlot, missionTwinCycleId, missionTwinLeaseDecision, buildMissionTwinReport };
