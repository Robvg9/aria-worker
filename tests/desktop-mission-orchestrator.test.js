'use strict';

const assert = require('node:assert/strict');
const {
  compileMission,
  validatePlan,
  executePlan,
  isAllowedShellScript
} = require('../autonomy/desktop-mission-orchestrator');
const { createWindowsMissionSimulator } = require('../autonomy/desktop-mission-simulator');

async function main() {
  const computerPlan = compileMission({ goal: 'Abre PowerShell y escribe una comprobación en la terminal' });
  assert.equal(computerPlan.strategy, 'computer');
  assert.equal(validatePlan(computerPlan).ok, true);
  assert.ok(computerPlan.steps.some(s => s.type === 'computer.use' && s.payload.action === 'open'));
  assert.ok(computerPlan.steps.some(s => s.type === 'computer.use' && s.payload.action === 'observe'));

  const ollamaPlan = compileMission({ goal: 'Comprueba si Ollama funciona y muestra su versión' });
  assert.equal(ollamaPlan.strategy, 'shell');
  assert.equal(validatePlan(ollamaPlan).ok, true);
  assert.ok(ollamaPlan.steps.some(s => s.type === 'computer.use' && s.payload.action === 'focus'));
  assert.ok(!ollamaPlan.steps.some(s => s.type === 'shell.execute' && /Remove-Item/i.test(s.payload.script)));

  assert.equal(isAllowedShellScript('Get-Date'), true);
  assert.equal(isAllowedShellScript('ollama --version'), true);
  assert.equal(isAllowedShellScript('Remove-Item C:\\important'), false);
  assert.equal(isAllowedShellScript('Start-Process powershell'), false);

  const simulator = createWindowsMissionSimulator();
  const e2ePlan = {
    version: 'test',
    constraints: { max_steps: 10 },
    steps: [
      { type: 'computer.use', payload: { action: 'open', target: 'PowerShell' } },
      { type: 'computer.use', payload: { action: 'focus', target: 'PowerShell' } },
      { type: 'computer.use', payload: { action: 'type', text: 'ollama --version' } },
      { type: 'computer.use', payload: { action: 'keypress', key: 'ENTER' } },
      { type: 'shell.execute', payload: { script: 'ollama --version' } },
      { type: 'computer.use', payload: { action: 'observe' } }
    ]
  };
  const e2e = await simulator.run(e2ePlan);
  assert.equal(e2e.result.status, 'succeeded');
  assert.equal(e2e.state.foreground, 'PowerShell');
  assert.deepEqual(e2e.state.commands, ['ollama --version']);
  assert.deepEqual(e2e.state.typed, ['ollama --version']);
  assert.ok(e2e.state.observations >= 1);

  const failed = await executePlan(
    {
      version: 'test',
      constraints: { max_steps: 2 },
      steps: [
        { type: 'computer.use', payload: { action: 'open', target: 'PowerShell' } },
        { type: 'computer.use', payload: { action: 'focus', target: 'PowerShell' } }
      ]
    },
    async ({ index }) => ({ status: index === 0 ? 'succeeded' : 'failed', error: 'simulated_failure' }),
    async ({ result }) => ({ ok: result.status === 'succeeded' })
  );
  assert.equal(failed.status, 'needs_replan');
  assert.equal(failed.failed_index, 1);

  const blocked = validatePlan({ constraints: { max_steps: 2 }, steps: [
    { type: 'shell.execute', payload: { script: 'Remove-Item C:\\x' } }
  ] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'shell_policy_blocked');

  console.log('DESKTOP_MISSION_ORCHESTRATOR_TEST=PASS');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
