'use strict';

async function runAutonomousLoop({ next, execute, verify = async () => true, policy, shouldStop = () => false }) {
  if (!policy || policy.enabled !== true) return { status: 'disabled', steps: 0, results: [] };
  const started = Date.now(); const results = [];
  for (let step = 0; step < policy.max_steps; step += 1) {
    if (shouldStop()) return { status: 'stopped', steps: step, results };
    if (Date.now() - started >= policy.max_runtime_ms) return { status: 'time_limit', steps: step, results };
    const goal = await next();
    if (!goal) return { status: 'idle', steps: step, results };
    const result = await execute(goal);
    results.push(result);
    if (!await verify(goal, result)) return { status: 'verification_failed', steps: step + 1, results };
  }
  return { status: 'step_limit', steps: policy.max_steps, results };
}

module.exports = { runAutonomousLoop };
