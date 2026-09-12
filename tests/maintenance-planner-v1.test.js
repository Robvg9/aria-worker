'use strict';

const assert = require('node:assert/strict');
const { createMaintenancePlanner, classifyFinding } = require('../autonomy/maintenance-planner-v1');
const { createAutonomyFrontier } = require('../autonomy/autonomy-frontier-v1');

(() => {
  const classified = classifyFinding({ category: 'security', severity: 'critical', confidence: 0.99, recurrence: 5, impact: 10 });
  assert.equal(classified.category, 'security');
  assert.ok(classified.score >= 85);
  assert.equal(classified.priority, 'critical');

  const frontier = createAutonomyFrontier({ now: () => '2026-09-12T20:00:00.000Z' });
  const planner = createMaintenancePlanner({ autonomyFrontier: frontier });
  const work = planner.plan([
    { id: 'a', title: 'fix docs', category: 'documentation', severity: 'low', confidence: 0.9, impact: 2 },
    { id: 'b', title: 'certify Windows', category: 'reliability', severity: 'high', requires_physical_device: true },
    { id: 'c', title: 'publish prod patch', category: 'regression', severity: 'high', mutating_production: true }
  ]);
  assert.equal(work.length, 3);
  assert.equal(work[0].id, 'c');
  assert.equal(work[1].pending.category, 'hardware_gate');
  assert.equal(work[2].execution.category, 'autonomous');
  assert.equal(planner.autonomous(work).length, 1);
  assert.equal(planner.pending(work).length, 2);

  console.log('MAINTENANCE_PLANNER_V1=PASS — prioritization, autonomous routing and pending human/hardware gates');
})();
