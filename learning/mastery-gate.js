'use strict';

const crypto = require('node:crypto');

const SPECIAL_TERMS = [
  'deno.json',
  'import_map',
  'import-map',
  'wrangler.toml',
  'package.json',
  'lockfile',
  'migration',
  'schema',
  'rls',
  'branch',
  'pull request',
  'ci',
  'e2e',
  'human gate',
];

function normalizeText(value, max = 1200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

function failureSignature(input = {}) {
  const source = {
    goal: normalizeText(input.goal, 1200).toLowerCase(),
    error_code: normalizeText(input.error_code, 240).toLowerCase(),
    failure_mode: normalizeText(input.failure_mode, 500).toLowerCase(),
    operation: normalizeText(input.operation, 180).toLowerCase(),
    executor_type: normalizeText(input.executor_type, 120).toLowerCase(),
    symptom: normalizeText(input.symptom, 600).toLowerCase(),
  };
  return 'failure_' + crypto.createHash('sha256').update(stableStringify(source)).digest('hex').slice(0, 24);
}

function deriveFailurePreventionProcedure({ goal = '', failureDetail = '', nextAction = '', previousPlan = [] } = {}) {
  const evidence = normalizeText([failureDetail, nextAction].filter(Boolean).join(' '), 1600).toLowerCase();
  const procedure = [
    'Recuperar el fallo previo y su evidencia antes de elegir una estrategia.',
    'No repetir la estrategia fallida salvo que exista evidencia nueva y explícita que la justifique.',
  ];

  const matched = SPECIAL_TERMS.filter((term) => evidence.includes(term));
  if (matched.includes('deno.json') || matched.includes('import_map') || matched.includes('import-map')) {
    procedure.push('Verificar el contrato real de deno.json y la configuración de import map antes del deploy.');
  }
  if (matched.includes('wrangler.toml')) {
    procedure.push('Verificar wrangler.toml y el destino de despliegue antes de ejecutar el deploy.');
  }
  if (matched.includes('migration') || matched.includes('schema')) {
    procedure.push('Verificar el estado real de la migración/esquema antes de volver a aplicar cambios.');
  }
  if (matched.includes('branch') || matched.includes('pull request') || matched.includes('ci')) {
    procedure.push('Verificar rama, PR y evidencia CI antes de declarar el cambio terminado.');
  }

  const planText = Array.isArray(previousPlan) ? normalizeText(JSON.stringify(previousPlan), 3000).toLowerCase() : '';
  if (planText && !procedure.some((item) => planText.includes(item.toLowerCase().slice(0, 35)))) {
    procedure.push('Construir una prueba de regresión que falle si la misma condición vuelve a aparecer.');
  } else {
    procedure.push('Construir y ejecutar una prueba de regresión contra la causa detectada.');
  }

  procedure.push('Verificar el resultado real post-acción y persistir la evidencia de que la prevención fue aplicada.');
  return [...new Set(procedure)].slice(0, 12);
}

function extractLearnedRequirements(skills = []) {
  return (Array.isArray(skills) ? skills : [])
    .filter((skill) => skill && skill.status !== 'retracted' && Number(skill.confidence ?? 0) >= 0.9)
    .map((skill) => {
      const req = skill.metadata?.preflight_requirements;
      const terms = Array.isArray(req?.terms) ? req.terms.map((term) => normalizeText(term, 200).toLowerCase()).filter(Boolean) : [];
      return {
        memory_id: skill.memory_id ?? null,
        title: normalizeText(skill.title, 300),
        learning_kind: skill.metadata?.learning_kind ?? null,
        application_required: skill.metadata?.preflight_required === true || skill.metadata?.learning_kind === 'failure_prevention',
        mode: req?.mode === 'contains_any' ? 'contains_any' : 'contains_all',
        terms,
      };
    })
    .filter((item) => item.application_required && item.terms.length > 0);
}

function validateLearningApplication({ plan = [], skills = [] } = {}) {
  const text = normalizeText(JSON.stringify(plan), 30000).toLowerCase();
  const requirements = extractLearnedRequirements(skills);
  const missing = [];
  const applied = [];
  for (const requirement of requirements) {
    const matched = requirement.mode === 'contains_any'
      ? requirement.terms.some((term) => text.includes(term))
      : requirement.terms.every((term) => text.includes(term));
    if (matched) applied.push(requirement.memory_id);
    else missing.push(requirement);
  }
  return Object.freeze({
    passed: missing.length === 0,
    requirements,
    applied_memory_ids: applied.filter(Boolean),
    missing,
  });
}

module.exports = Object.freeze({
  SPECIAL_TERMS,
  normalizeText,
  failureSignature,
  deriveFailurePreventionProcedure,
  extractLearnedRequirements,
  validateLearningApplication,
});
