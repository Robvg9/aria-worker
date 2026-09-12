'use strict';

const assert = require('node:assert/strict');
const { createDesktopMissionReplanner } = require('../autonomy/desktop-mission-replanner');

(async () => {
  const replanner = createDesktopMissionReplanner({ max_alternatives: 2 });

  const focus = await replanner.replan({
    mission: { target: { device_id: 'windows-local' } },
    failed_step: {
      id: 's1', operation: 'computer.use',
      target: { type: 'device', device_id: 'windows-local' },
      input: { action: 'focus', process: 'powershell' },
      retryable: true
    },
    outcome: { verification: { reason: 'focused_process_mismatch' } },
    replan_count: 1
  });

  assert.equal(focus.length, 2);
  assert.equal(focus[0].input.action, 'observe');
  assert.equal(focus[1].input.action, 'focus');
  assert.equal(focus[1].input.process, 'powershell');
  assert.equal(focus.every(step => step.depends_on.length === 0), true);

  const type = await replanner.replan({
    mission: { target: { device_id: 'windows-local' } },
    failed_step: {
      id: 's2', operation: 'computer.use',
      target: { type: 'device', device_id: 'windows-local' },
      input: { action: 'type', text: 'ollama --version' }
    },
    outcome: { verification: { reason: 'focused_process_mismatch' } },
    replan_count: 0
  });
  assert.equal(type[1].input.action, 'focus');
  assert.equal(type[1].verify.focused_process, 'powershell');

  const blocked = await replanner.replan({
    mission: { target: { device_id: 'windows-local' } },
    failed_step: { id: 's3', operation: 'shell.execute', target: { type: 'device', device_id: 'windows-local' }, command: 'Remove-Item x' },
    outcome: { error: 'shell_policy_blocked' },
    replan_count: 0
  });
  assert.equal(blocked.length, 0);

  console.log('DESKTOP MISSION REPLANNER: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
