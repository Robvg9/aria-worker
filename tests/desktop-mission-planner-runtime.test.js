'use strict';

const assert = require('node:assert/strict');
const { createDesktopMissionPlanner, riskForComputerAction } = require('../autonomy/desktop-mission-planner');
const { selectExecutor } = require('../autonomy/universal-execution/selector');
const { listExecutors } = require('../autonomy/universal-execution/lookup');

const planner = createDesktopMissionPlanner({ device_id: 'windows-test' });
const plan = planner.plan({ goal: 'Abre PowerShell y escribe una comprobación en la terminal' });

assert.equal(plan.status, 'planned');
assert.equal(plan.mission_type, 'desktop');
assert.equal(plan.target.device_id, 'windows-test');
assert.ok(plan.steps.length >= 3);

for (const step of plan.steps) {
  assert.equal(step.executor_type, 'device');
  assert.equal(step.target.device_id, 'windows-test');
  assert.equal(step.risk, 'low');
  assert.equal(selectExecutor(step, { list: listExecutors }).type, 'device');
}

const hasComputer = plan.steps.some(step => step.operation === 'computer.use');
assert.equal(hasComputer, true);
assert.ok(plan.steps.every(step => typeof step.input === 'object' || typeof step.command === 'string'));
assert.equal(plan.steps.find(step => step.input?.action === 'open')?.input?.path, 'powershell.exe');
assert.equal(plan.steps.find(step => step.input?.action === 'focus')?.verify?.focused_process, 'powershell');

const ollama = planner.plan({ goal: 'Comprueba si Ollama funciona y muestra su versión' });
assert.equal(ollama.status, 'planned');
assert.ok(ollama.steps.some(step => step.operation === 'computer.use' && step.input?.action === 'type'));

assert.deepEqual(riskForComputerAction('observe'), { policy: 'low', class: 'READ' });
assert.deepEqual(riskForComputerAction('focus'), { policy: 'low', class: 'READ' });
assert.deepEqual(riskForComputerAction('type'), { policy: 'low', class: 'LOW_RISK_WRITE' });
assert.deepEqual(riskForComputerAction('keypress'), { policy: 'low', class: 'LOW_RISK_WRITE' });

console.log('DESKTOP_MISSION_PLANNER_RUNTIME_TEST=PASS');
