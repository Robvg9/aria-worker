'use strict';

async function rollback(completedSteps, compensators = {}) {
  if (!Array.isArray(completedSteps)) return { status:'blocked', reason:'steps_missing', rolled_back:[] };
  const rolledBack = [];
  for (const step of [...completedSteps].reverse()) {
    const compensate = compensators[step.id];
    if (typeof compensate !== 'function') return { status:'partial', reason:'compensator_missing', rolled_back:rolledBack, pending:step.id };
    try {
      const result = await compensate(step);
      if (result && result.status === 'succeeded') rolledBack.push(step.id);
      else return { status:'partial', reason:'compensation_failed', rolled_back:rolledBack, pending:step.id };
    } catch (_) { return { status:'partial', reason:'compensation_error', rolled_back:rolledBack, pending:step.id }; }
  }
  return { status:'rolled_back', rolled_back:rolledBack };
}

module.exports = { rollback };
