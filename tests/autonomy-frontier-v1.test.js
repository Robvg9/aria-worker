'use strict';

const assert = require('node:assert/strict');
const { CATEGORIES, classifyRequirement, createAutonomyFrontier } = require('../autonomy/autonomy-frontier-v1');

(() => {
  assert.deepEqual(CATEGORIES, ['autonomous', 'human_gate', 'hardware_gate', 'external_authority']);
  assert.equal(classifyRequirement({ goal: 'inspect code' }).category, 'autonomous');
  assert.equal(classifyRequirement({ goal: 'run on local Windows', requires_physical_device: true }).category, 'hardware_gate');
  assert.equal(classifyRequirement({ goal: 'publish production change', mutating_production: true }).category, 'human_gate');
  assert.equal(classifyRequirement({ goal: 'authorize external provider', requires_external_authority: true }).category, 'external_authority');

  const frontier = createAutonomyFrontier({ now: () => '2026-09-12T20:00:00.000Z' });
  const auto = frontier.assess({ goal: 'build tests' });
  assert.equal(auto.classification.executable, true);
  assert.equal(auto.pending, null);

  const pc = frontier.assess({ goal: 'certify PowerShell on PC', requires_physical_device: true, device_class: 'windows_local' });
  assert.equal(pc.classification.category, 'hardware_gate');
  assert.equal(pc.pending.pc_required, true);
  assert.equal(frontier.list({ category: 'hardware_gate' }).length, 1);

  const human = frontier.assess({ goal: 'deploy production', requires_human_approval: true });
  assert.equal(human.classification.category, 'human_gate');
  const closed = frontier.close(human.pending.id, 'Robert approved');
  assert.equal(closed.status, 'closed');

  console.log('AUTONOMY_FRONTIER_V1=PASS — autonomous execution classification, hardware/human/external gates and pending queue');
})();
