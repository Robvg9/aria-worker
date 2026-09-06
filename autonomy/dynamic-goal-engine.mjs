const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const text = (value) => typeof value === 'string' ? value.trim() : '';
const keyOf = (value) => text(value).toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9:_ -]/g, '');

function freshnessScore(createdAt, now) {
  const ts = Date.parse(createdAt || '');
  if (!Number.isFinite(ts)) return 0;
  const ageHours = Math.max(0, (Date.parse(now) - ts) / 3600000);
  if (ageHours <= 1) return 10;
  if (ageHours <= 6) return 8;
  if (ageHours <= 24) return 6;
  if (ageHours <= 72) return 3;
  return 0;
}

function sourceWeight(source) {
  return ({ priority: 30, roadmap: 28, capability_gap: 26, failure: 24, learning: 18, seed: 12 })[source] ?? 10;
}

export function scoreCandidate(candidate, context = {}) {
  const now = context.now || new Date().toISOString();
  const source = text(candidate.source_type) || 'seed';
  const base = clamp(candidate.priority, 0, 100) * 0.45;
  const urgency = clamp(candidate.urgency, 0, 100) * 0.20;
  const impact = clamp(candidate.impact, 0, 100) * 0.15;
  const confidence = clamp(candidate.confidence, 0, 1) * 10;
  const freshness = freshnessScore(candidate.created_at || candidate.source_created_at, now);
  const sourceSignal = sourceWeight(source);
  const strategicSignal = candidate.strategic ? 8 : 0;
  const attemptsPenalty = Math.min(15, Math.max(0, Number(candidate.attempts || 0) * 3));
  const historicalPenalty = candidate.historical ? 8 : 0;
  return Number((base + urgency + impact + confidence + freshness + sourceSignal + strategicSignal - attemptsPenalty - historicalPenalty).toFixed(6));
}

function candidateFromGoal(goal) {
  const priority = Number(goal.priority || 0);
  const metadata = goal.metadata && typeof goal.metadata === 'object' ? goal.metadata : {};
  const strategic = Boolean(metadata.strategic || metadata.strategic_priority || metadata.roadmap_priority || priority >= 75);
  const historical = ['blocked', 'completed'].includes(text(goal.status)) || Boolean(metadata.historical);
  return { goal_id: text(goal.goal_id), goal: text(goal.goal), priority, source_type: strategic ? 'priority' : (text(goal.source_type) || 'seed'), source_ref: text(goal.source_ref) || text(goal.goal_id), created_at: goal.created_at, attempts: Number(goal.attempts || 0), status: text(goal.status) || 'queued', urgency: Number(goal.urgency || 0), impact: Number(goal.impact || 0), confidence: Number(goal.confidence ?? 0.5), strategic, historical };
}

function generatedId(source, ref, objective) {
  return `dyn-${source}-${keyOf(ref || objective).slice(0, 64).replace(/ /g, '-') || 'goal'}`;
}

function deriveFromFailure(failure) {
  const goal = text(failure.goal);
  const stderr = text(failure.last_stderr || failure.error || failure.summary);
  if (!goal && !stderr) return null;
  const ref = text(failure.mission_id) || keyOf(goal).slice(0, 48);
  return { goal_id: generatedId('failure', ref, goal), goal: `Diagnose and resolve the verified failure from mission ${ref}: ${stderr || goal}`.slice(0, 500), priority: 72, urgency: 82, impact: 86, confidence: 0.85, source_type: 'failure', source_ref: ref, source_created_at: failure.updated_at || failure.created_at, metadata: { derived_from_failure: ref, original_goal: goal || null } };
}

function deriveFromCapabilityGap(row) {
  const capability = text(row.capability_id);
  const model = text(row.model_id);
  const notes = text(row.notes);
  if (!capability) return null;
  const sourceRef = `${capability}:${model || 'any'}`;
  return { goal_id: generatedId('capability_gap', sourceRef, capability), goal: `Close the capability gap for ${capability}${model ? ` on ${model}` : ''}: verify capability, implement the smallest governed path, test it, and register evidence.`.slice(0, 500), priority: 68, urgency: 60, impact: 78, confidence: row.status === 'verified' ? 0.6 : 0.9, source_type: 'capability_gap', source_ref: sourceRef, source_created_at: row.updated_at || row.verified_at, metadata: { capability_id: capability, model_id: model || null, notes: notes || null } };
}

function deriveFromLearning(learning) {
  const summary = text(learning.summary);
  const goalId = text(learning.goal_id);
  if (!summary || !['operational_failure', 'verified_success'].includes(text(learning.category))) return null;
  const ref = text(learning.lesson_id) || goalId || keyOf(summary).slice(0, 48);
  const isFailure = learning.category === 'operational_failure';
  return { goal_id: generatedId('learning', ref, summary), goal: `${isFailure ? 'Turn this reusable failure lesson into a verified corrective action' : 'Turn this verified success into a reusable hardening/automation improvement'}: ${summary}`.slice(0, 500), priority: isFailure ? 64 : 42, urgency: isFailure ? 70 : 35, impact: isFailure ? 72 : 58, confidence: clamp(learning.confidence ?? 0.7, 0, 1), source_type: 'learning', source_ref: ref, source_created_at: learning.created_at, metadata: { lesson_id: learning.lesson_id || null, goal_id: goalId || null, category: learning.category } };
}

function normalizeCandidate(candidate, context = {}) {
  const id = text(candidate.goal_id) || generatedId(text(candidate.source_type) || 'dynamic', text(candidate.source_ref), candidate.goal);
  const normalized = { ...candidate, goal_id: id, goal: text(candidate.goal), status: text(candidate.status) || 'queued', source_type: text(candidate.source_type) || 'seed', source_ref: text(candidate.source_ref), priority: clamp(candidate.priority, 0, 100), urgency: clamp(candidate.urgency, 0, 100), impact: clamp(candidate.impact, 0, 100), confidence: clamp(candidate.confidence ?? 0.5, 0, 1), strategic: Boolean(candidate.strategic), historical: Boolean(candidate.historical) };
  return { ...normalized, dynamic_score: scoreCandidate(normalized, context) };
}

export function generateCandidates({ goals = [], failures = [], capabilityGaps = [], learnings = [], roadmap = [], priorities = [] } = {}, context = {}) {
  const raw = [];
  for (const goal of goals) raw.push(candidateFromGoal(goal));
  for (const failure of failures) { const candidate = deriveFromFailure(failure); if (candidate) raw.push(candidate); }
  for (const gap of capabilityGaps) { const candidate = deriveFromCapabilityGap(gap); if (candidate) raw.push(candidate); }
  for (const learning of learnings) { const candidate = deriveFromLearning(learning); if (candidate) raw.push(candidate); }
  for (const item of [...roadmap, ...priorities]) {
    const goal = text(item.goal || item.objective || item.title);
    if (!goal) continue;
    raw.push({ goal_id: text(item.goal_id) || generatedId('roadmap', item.ref || item.id, goal), goal, priority: item.priority ?? 50, urgency: item.urgency ?? 50, impact: item.impact ?? 60, confidence: item.confidence ?? 0.8, source_type: text(item.source_type) || 'roadmap', source_ref: text(item.source_ref || item.ref || item.id), source_created_at: item.created_at, metadata: item.metadata || {}, strategic: true });
  }
  const dedup = new Map();
  for (const candidate of raw) {
    const normalized = normalizeCandidate(candidate, context);
    if (!normalized.goal) continue;
    const fingerprint = keyOf(normalized.goal);
    const previous = dedup.get(fingerprint);
    if (!previous || normalized.dynamic_score > previous.dynamic_score || (normalized.dynamic_score === previous.dynamic_score && normalized.goal_id < previous.goal_id)) dedup.set(fingerprint, normalized);
  }
  return [...dedup.values()].sort((a, b) => b.dynamic_score - a.dynamic_score || a.goal_id.localeCompare(b.goal_id));
}

export function selectDynamicGoal(candidates, { blockedIds = new Set(), activeIds = new Set() } = {}) {
  const blocked = blockedIds instanceof Set ? blockedIds : new Set(blockedIds);
  const active = activeIds instanceof Set ? activeIds : new Set(activeIds);
  return (candidates || []).find((candidate) => { const state = text(candidate.status) || 'queued'; if (blocked.has(candidate.goal_id) || active.has(candidate.goal_id)) return false; return state === 'queued' || state === 'paused'; }) || null;
}

export const dynamicGoalEngine = Object.freeze({ generateCandidates, selectDynamicGoal, scoreCandidate });
