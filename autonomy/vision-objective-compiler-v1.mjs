const text = (v) => typeof v === 'string' ? v.trim() : '';

export function compileVisionObjective(objective) {
  if (!objective || !text(objective.objective) || !text(objective.objective_id)) throw new TypeError('vision_objective_required');
  const id = text(objective.objective_id);
  const acceptance = text(objective.acceptance);
  const verifier = objective.verifier && typeof objective.verifier === 'object' ? objective.verifier : { type: 'evidence_required', success_conditions: ['reproducible_evidence'] };
  const dependencies = Array.isArray(objective.dependencies) ? objective.dependencies.map(text).filter(Boolean) : [];
  return { goal_id: `vision-${id}`, goal: text(objective.objective), priority: Number.isFinite(Number(objective.priority)) ? Number(objective.priority) : 50, status: ['completed','blocked','paused'].includes(text(objective.status)) ? text(objective.status) : 'queued', source_type: 'vision', source_ref: `${text(objective.vision_id) || 'aria-master-vision-v1'}:${id}`, metadata: { vision_objective_id: id, vision_id: text(objective.vision_id), acceptance, verifier, dependencies, source_section: text(objective.source_section), autonomous: objective.metadata?.autonomous !== false, requires_human_gate: text(objective.metadata?.requires_human_gate) || null, physical_gate: objective.metadata?.physical_gate === true, blocked_until_prerequisites: objective.metadata?.blocked_until_prerequisites === true, compiled: true, compiler_version: 'vision-objective-compiler-v1' } };
}

export function compileVisionObjectives(objectives = []) { return objectives.map(compileVisionObjective).filter(Boolean); }
