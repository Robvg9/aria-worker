'use strict';

function createResourceGuard(input = {}) {
  const maxActions = Number.isInteger(input.max_actions) && input.max_actions > 0 ? input.max_actions : 20;
  const maxFailures = Number.isInteger(input.max_failures) && input.max_failures >= 0 ? input.max_failures : 3;
  let actions = 0; let failures = 0;
  return {
    canAct() { return actions < maxActions && failures < maxFailures; },
    recordAction() { if (!this.canAct()) throw new Error('autonomy resource limit'); actions += 1; },
    recordFailure() { failures += 1; },
    snapshot() { return { actions, failures, max_actions: maxActions, max_failures: maxFailures }; }
  };
}

module.exports = { createResourceGuard };
