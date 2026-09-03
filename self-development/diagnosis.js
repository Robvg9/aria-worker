'use strict';

const SEVERITIES = Object.freeze(['info','low','medium','high','critical']);

function createSelfDiagnoser({ rules = [] } = {}) {
  if (!Array.isArray(rules)) throw new TypeError('rules_must_be_array');
  const normalized = rules.map((rule, index) => {
    if (!rule || typeof rule.id !== 'string' || typeof rule.check !== 'function') throw new TypeError(`invalid_rule_${index}`);
    const severity = SEVERITIES.includes(rule.severity) ? rule.severity : 'medium';
    return Object.freeze({ id: rule.id, severity, description: rule.description || '', check: rule.check });
  });

  async function diagnose(snapshot) {
    const findings = [];
    for (const rule of normalized) {
      try {
        const result = await rule.check(snapshot);
        if (result === true) findings.push({ rule_id: rule.id, severity: rule.severity, description: rule.description });
      } catch (_) {
        findings.push({ rule_id: rule.id, severity: 'high', description: `diagnostic rule ${rule.id} failed` });
      }
    }
    return { status: 'succeeded', findings };
  }

  return Object.freeze({ diagnose, rules: normalized.map(({ check, ...meta }) => ({ ...meta })) });
}

module.exports = { createSelfDiagnoser, SEVERITIES };
