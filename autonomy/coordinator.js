'use strict';

const { createAutonomyPolicy, riskAllowed } = require('./policy');
const { createGoal, transition } = require('./goals');
const { createPriorityQueue } = require('./priority-queue');
const { createStopController } = require('./stop-controller');
const { createResourceGuard } = require('./resource-guard');
const { runAutonomousLoop } = require('./loop');

function createAutonomyCoordinator({ policy = {}, execute, verify, now, selfDevelopment = null } = {}) {
  if (typeof execute !== 'function') throw new Error('execute function required');
  if (selfDevelopment !== null && typeof selfDevelopment !== 'function') throw new Error('selfDevelopment must be a function');
  const p = createAutonomyPolicy(policy); const queue = createPriorityQueue();
  const stop = createStopController(); const resources = createResourceGuard(policy.resources);
  function submit(input) {
    const goal = createGoal(input);
    if (!riskAllowed(goal.risk, p)) return { accepted: false, reason: 'risk_blocked', goal };
    queue.push(goal); return { accepted: true, goal };
  }
  async function run() {
    return runAutonomousLoop({
      policy: p, shouldStop: stop.isStopped,
      next: async () => { if (!resources.canAct()) return null; const g = queue.next(); if (!g) return null; return transition(g, 'active'); },
      execute: async goal => {
        resources.recordAction();
        try {
          const result = goal.metadata && goal.metadata.self_development === true && selfDevelopment
            ? await selfDevelopment(goal)
            : await execute(goal);
          return { goal, result };
        } catch (error) {
          resources.recordFailure();
          return { goal, error: String(error && error.message || error) };
        }
      },
      verify: async (goal, result) => typeof verify === 'function' ? Boolean(await verify(goal, result)) : !result.error
    });
  }
  return { policy: p, submit, run, stop, resources, queue };
}

module.exports = { createAutonomyCoordinator };
