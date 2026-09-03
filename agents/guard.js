'use strict';

function createAgentGuard({ max_depth = 2, max_agents = 4, max_steps = 8 } = {}) {
  if (![max_depth, max_agents, max_steps].every(Number.isInteger) || max_depth < 0 || max_agents < 1 || max_steps < 1) throw new Error('invalid guard limits');
  let active = 0; let steps = 0;
  return {
    canSpawn(depth) { return active < max_agents && steps < max_steps && depth < max_depth; },
    spawned() { if (active >= max_agents) return false; active += 1; steps += 1; return true; },
    finished() { if (active > 0) active -= 1; },
    canStep() { return steps < max_steps; },
    step() { if (!this.canStep()) return false; steps += 1; return true; },
    snapshot() { return { active, steps, max_depth, max_agents, max_steps }; }
  };
}

module.exports = { createAgentGuard };