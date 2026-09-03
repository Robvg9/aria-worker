'use strict';

const MUTATIONS = Object.freeze(['modify_file','add_file','delete_file']);

function createImprovementPlanner({ allowMutation = null } = {}) {
  async function plan({ findings = [], objective = null, proposed_changes = [] } = {}) {
    if (!Array.isArray(findings) || !Array.isArray(proposed_changes)) throw new TypeError('invalid_plan_input');
    const changes = proposed_changes.filter(change => change && MUTATIONS.includes(change.type) && typeof change.path === 'string' && change.path);
    for (const change of changes) {
      if (allowMutation && (await allowMutation(change)) !== true) change.status = 'blocked';
      else change.status = 'proposed';
    }
    return Object.freeze({ status: 'planned', objective: objective || 'self_improvement', finding_count: findings.length, changes: structuredClone(changes) });
  }
  return Object.freeze({ plan, mutationTypes: [...MUTATIONS] });
}

module.exports = { createImprovementPlanner, MUTATIONS };
