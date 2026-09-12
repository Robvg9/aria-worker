'use strict';

const { createAutonomyFrontier } = require('./autonomy-frontier-v1');
const { createMaintenancePlanner } = require('./maintenance-planner-v1');

function createEvolutionSupervisor({ frontier = null, maintenance = null } = {}) {
  const autonomyFrontier = frontier || createAutonomyFrontier();
  const maintenancePlanner = maintenance || createMaintenancePlanner({ autonomyFrontier });

  function inspectFindings(findings = []) {
    const planned = maintenancePlanner.plan(findings);
    return Object.freeze({
      status: 'planned',
      total: planned.length,
      autonomous: maintenancePlanner.autonomous(planned),
      pending: maintenancePlanner.pending(planned)
    });
  }

  function routeFinding(finding = {}) {
    const result = autonomyFrontier.assess({
      goal: finding.goal || finding.title,
      requires_human_approval: finding.mutating_production === true || finding.irreversible === true || finding.requires_human_approval === true,
      requires_physical_device: finding.requires_physical_device === true || finding.requires_local_hardware === true,
      device_class: finding.device_class,
      requires_external_authority: finding.requires_external_authority === true,
      requires_external_credentials: finding.requires_external_credentials === true
    });
    return Object.freeze({ finding, classification: result.classification, pending: result.pending });
  }

  return Object.freeze({ version: 'evolution-supervisor-v1.0', inspectFindings, routeFinding, frontier: autonomyFrontier, maintenance: maintenancePlanner });
}

module.exports = Object.freeze({ createEvolutionSupervisor });
