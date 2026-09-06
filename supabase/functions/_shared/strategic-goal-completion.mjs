const READ_ONLY_OPERATIONS = new Set([
  'file_read',
  'account_read',
  'content_read',
  'deployment_read',
  'worker_read',
  'health',
  'mission_read',
]);

const IMPLEMENTATION_VERBS = /\b(implement|implementation|integrate|integration|connect|connection|fix|correct|correction|create|add|deploy|provision|rotate|build|enable|configure|integrar|implementar|conectar|corregir|crear|añadir|desplegar|provisionar|rotar|construir|habilitar|configurar)\b/i;

export function strategicProgressRequired(goal, goalSource) {
  const source = String(goalSource || '').trim().toLowerCase();
  return (source === 'priority' || source === 'roadmap') && IMPLEMENTATION_VERBS.test(String(goal || ''));
}

export function hasActionableProgress(steps = []) {
  return Array.isArray(steps) && steps.some((step) => {
    const operation = String(step?.operation || '').trim().toLowerCase();
    return operation && !READ_ONLY_OPERATIONS.has(operation);
  });
}

export function verifyStrategicCompletion({ goal, goalSource, steps = [] } = {}) {
  if (!strategicProgressRequired(goal, goalSource)) {
    return { required: false, verified: true, reason: 'not_strategic_implementation_goal' };
  }
  if (hasActionableProgress(steps)) {
    return { required: true, verified: true, reason: 'actionable_progress_present' };
  }
  return { required: true, verified: false, reason: 'read_only_plan_cannot_complete_strategic_implementation_goal' };
}
