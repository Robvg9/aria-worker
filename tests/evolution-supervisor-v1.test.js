'use strict';

const assert = require('node:assert/strict');
const { createEvolutionSupervisor } = require('../autonomy/evolution-supervisor-v1');

(() => {
  const supervisor = createEvolutionSupervisor({ frontier: undefined });
  const routed = supervisor.routeFinding({ title: 'Windows certification', requires_physical_device: true, device_class: 'windows_local' });
  assert.equal(routed.classification.category, 'hardware_gate');
  assert.equal(routed.pending.pc_required, true);

  const batch = supervisor.inspectFindings([
    { id: 'a', title: 'Improve docs', category: 'documentation', severity: 'low', impact: 2 },
    { id: 'b', title: 'Production regression', category: 'regression', severity: 'high', mutating_production: true }
  ]);
  assert.equal(batch.status, 'planned');
  assert.equal(batch.total, 2);
  assert.equal(batch.pending.length, 1);
  assert.equal(batch.autonomous.length, 1);

  console.log('EVOLUTION_SUPERVISOR_V1=PASS — maintenance findings routed into autonomous work or explicit pending gates');
})();
