'use strict';

const STAGES = Object.freeze(['research', 'design', 'implement', 'test', 'verify', 'learn', 'promote']);

function createDevelopmentPlanner({ max_stages = 7 } = {}) {
  const limit = Number.isInteger(max_stages) && max_stages > 0 ? Math.min(max_stages, STAGES.length) : STAGES.length;
  function plan({ goal, gaps = [], context = {} } = {}) {
    const task = typeof goal === 'string' ? goal.trim() : '';
    if (!task) throw new TypeError('goal_required');
    if (!Array.isArray(gaps)) throw new TypeError('gaps_must_be_array');
    const normalized = gaps.map((gap, index) => {
      const id = String(gap?.capability_id || `gap_${index + 1}`);
      const dependencies = Array.isArray(gap?.dependencies) ? gap.dependencies.map(String) : [];
      return { capability_id: id, priority: String(gap?.priority || 'medium'), dependencies };
    });
    const steps = [];
    for (const gap of normalized) {
      let previous = null;
      for (const stage of STAGES.slice(0, limit)) {
        const id = `${gap.capability_id}:${stage}`;
        const step = Object.freeze({
          id,
          capability_id: gap.capability_id,
          stage,
          action: `${stage}_capability`,
          depends_on: previous ? [previous] : [],
          priority: gap.priority,
          human_gate_required: stage === 'promote' && gap.priority === 'critical',
        });
        steps.push(step);
        previous = id;
      }
    }
    return Object.freeze({
      status: steps.length ? 'planned' : 'no_gaps',
      goal: task,
      context: Object.freeze({ ...context }),
      gaps: Object.freeze(normalized),
      stages: Object.freeze(STAGES.slice(0, limit)),
      steps: Object.freeze(steps),
      plan_version: 'self-development-planner-v2.0.0'
    });
  }
  return Object.freeze({ plan, stages: [...STAGES] });
}

module.exports = Object.freeze({ createDevelopmentPlanner, STAGES });
