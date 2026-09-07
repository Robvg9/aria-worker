'use strict';

const RISK = Object.freeze(['safe', 'low', 'medium', 'high', 'destructive', 'human_gate']);
const WEIGHT = Object.freeze({ safe: 0, low: 10, medium: 25, high: 50, destructive: 90, human_gate: 100 });

function analyzeChangeRisk({ changes = [], protectedPaths = [], dependencyGraph = {} } = {}) {
  if (!Array.isArray(changes)) throw new TypeError('changes_must_be_array');
  const protectedSet = new Set((Array.isArray(protectedPaths) ? protectedPaths : []).map(String));
  const findings = [];
  let max = 'safe';
  for (const change of changes) {
    const path = String(change?.path || '');
    const type = String(change?.type || 'modify_file');
    const deps = Array.isArray(dependencyGraph[path]) ? dependencyGraph[path].map(String) : [];
    let level = 'low';
    const reasons = [];
    if (protectedSet.has(path)) { level = 'human_gate'; reasons.push('protected_path'); }
    else if (type === 'delete_file') { level = 'destructive'; reasons.push('deletion'); }
    else if (deps.length >= 3) { level = 'high'; reasons.push('high_dependency_fanout'); }
    else if (type === 'add_file') { level = 'low'; reasons.push('additive_change'); }
    else { level = 'medium'; reasons.push('mutation'); }
    if (String(path).includes('migration')) { level = WEIGHT[level] < WEIGHT.high ? 'high' : level; reasons.push('schema_migration'); }
    if (WEIGHT[level] > WEIGHT[max]) max = level;
    findings.push({ path, type, risk_level: level, risk_score: WEIGHT[level], reasons, dependencies: deps });
  }
  const approval = max === 'human_gate' ? 'human_gate' : (max === 'destructive' || max === 'high' ? 'elevated_review' : 'automatic_allowed');
  return Object.freeze({ status: 'analyzed', max_risk: max, max_risk_score: WEIGHT[max], approval_requirement: approval, changes: Object.freeze(findings), analyzer_version: 'change-risk-analyzer-v2.0.0' });
}

function riskAtOrBelow(candidate, maxRisk = 'low') {
  return WEIGHT[candidate] <= WEIGHT[maxRisk];
}

module.exports = Object.freeze({ analyzeChangeRisk, riskAtOrBelow, RISK, WEIGHT });
