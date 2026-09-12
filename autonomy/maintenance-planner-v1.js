'use strict';

const PRIORITIES = Object.freeze(['critical', 'high', 'medium', 'low']);
const CATEGORIES = Object.freeze(['regression', 'security', 'reliability', 'performance', 'dependency', 'documentation', 'observability', 'capability_gap']);

function scoreFinding(finding = {}) {
  const severity = PRIORITIES.indexOf(String(finding.severity || 'low').toLowerCase());
  const confidence = Number.isFinite(finding.confidence) ? Math.max(0, Math.min(1, finding.confidence)) : 0.5;
  const recurrence = Number.isFinite(finding.recurrence) ? Math.max(0, finding.recurrence) : 0;
  const impact = Number.isFinite(finding.impact) ? Math.max(0, Math.min(10, finding.impact)) : 5;
  const gateWeight = finding.mutating_production || finding.irreversible || finding.requires_human_approval ? 8 : 0;
  const hardwareWeight = finding.requires_physical_device || finding.requires_local_hardware ? 4 : 0;
  return Math.round(((severity + 1) * 25 + confidence * 25 + Math.min(recurrence, 10) * 2.5 + impact * 2.5 + gateWeight + hardwareWeight));
}

function classifyFinding(finding = {}) {
  const category = CATEGORIES.includes(finding.category) ? finding.category : 'capability_gap';
  const score = scoreFinding(finding);
  const priority = score >= 85 ? 'critical' : score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';
  const requiresHuman = finding.mutating_production === true || finding.irreversible === true || finding.requires_human_approval === true;
  const requiresHardware = finding.requires_physical_device === true || finding.requires_local_hardware === true;
  return Object.freeze({ category, score, priority, requiresHuman, requiresHardware });
}

function createMaintenancePlanner({ autonomyFrontier = null } = {}) {
  function plan(findings = []) {
    if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
    const work = [];
    for (const finding of findings) {
      if (!finding || typeof finding !== 'object') continue;
      const classification = classifyFinding(finding);
      const frontier = typeof autonomyFrontier?.assess === 'function'
        ? autonomyFrontier.assess({
          goal: finding.goal || finding.title || 'maintenance finding',
          requires_human_approval: classification.requiresHuman,
          requires_physical_device: classification.requiresHardware
        })
        : null;
      work.push(Object.freeze({
        id: finding.id || `maintenance_${work.length + 1}`,
        title: String(finding.title || finding.goal || 'Maintenance finding').slice(0, 300),
        classification,
        execution: frontier?.classification || { category: 'autonomous', executable: true, requires: [], reasons: [] },
        pending: frontier?.pending || null,
        evidence: finding.evidence || null
      }));
    }
    work.sort((a, b) => b.classification.score - a.classification.score || Number(b.classification.requiresHuman) - Number(a.classification.requiresHuman) || Number(b.classification.requiresHardware) - Number(a.classification.requiresHardware) || a.id.localeCompare(b.id));
    return Object.freeze(work);
  }

  function selectPlanned(findings, predicate) {
    if (!Array.isArray(findings)) throw new TypeError('findings must be an array');
    const planned = findings.length > 0 && findings[0] && findings[0].execution && findings[0].classification ? findings : plan(findings);
    return Object.freeze(planned.filter(predicate));
  }

  function autonomous(findings = []) {
    return selectPlanned(findings, item => item.execution.category === 'autonomous' && item.execution.executable);
  }

  function pending(findings = []) {
    return selectPlanned(findings, item => Boolean(item.pending));
  }

  return Object.freeze({ version: 'maintenance-planner-v1.1', plan, autonomous, pending });
}

module.exports = Object.freeze({ PRIORITIES, CATEGORIES, scoreFinding, classifyFinding, createMaintenancePlanner });
