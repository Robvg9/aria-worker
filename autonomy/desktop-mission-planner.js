'use strict';

const { compileMission, validatePlan } = require('./desktop-mission-orchestrator');

const VERSION = 'aria-desktop-mission-planner-v1.1';
const DEFAULT_DEVICE_ID = 'windows-local';

const READ_ACTIONS = new Set(['screenshot', 'observe', 'focus']);
const LOW_WRITE_ACTIONS = new Set(['open', 'click', 'type', 'keypress', 'scroll']);

function riskForComputerAction(action) {
  if (READ_ACTIONS.has(action)) return 'READ';
  if (LOW_WRITE_ACTIONS.has(action)) return 'LOW_RISK_WRITE';
  return 'HIGH_RISK_WRITE';
}

function inferVerify(step) {
  if (step.type !== 'computer.use') return undefined;
  const input = step.payload || {};
  if (input.action === 'focus' && input.process) return { focused_process: input.process };
  if (input.action === 'open' && input.target) return { focused_title: input.target };
  return undefined;
}

function toRuntimeStep(step, index, device_id) {
  if (!step || typeof step !== 'object') throw new TypeError('desktop step required');
  const id = `desktop_step_${index + 1}`;
  const target = Object.freeze({ type: 'device', device_id });
  if (step.type === 'computer.use') {
    const input = Object.freeze({ ...(step.payload || {}) });
    return Object.freeze({
      id,
      operation: 'computer.use',
      executor_type: 'device',
      target,
      input,
      timeout_ms: 120000,
      policy: Object.freeze({ desktop_governed: true, risk_class: riskForComputerAction(input.action) }),
      ...(inferVerify(step) ? { verify: Object.freeze(inferVerify(step)) } : {})
    });
  }
  if (step.type === 'shell.execute') {
    return Object.freeze({
      id,
      operation: 'shell.execute',
      executor_type: 'device',
      target,
      command: step.payload?.script,
      timeout_ms: 120000,
      policy: Object.freeze({ desktop_governed: true, risk_class: 'READ', shell_policy: 'desktop-mission-safe' })
    });
  }
  throw new Error(`unsupported desktop step type: ${step.type}`);
}

function createDesktopMissionPlanner({ device_id = DEFAULT_DEVICE_ID, max_steps = 12 } = {}) {
  if (typeof device_id !== 'string' || !device_id.trim()) throw new TypeError('device_id must be non-empty');
  if (!Number.isInteger(max_steps) || max_steps < 1 || max_steps > 50) throw new TypeError('max_steps must be 1..50');

  function plan({ goal, constraints = {} } = {}) {
    const desktop = compileMission({ goal, target: device_id, constraints: { max_steps, ...constraints } });
    const validation = validatePlan(desktop);
    if (!validation.ok) return Object.freeze({ status: 'blocked', version: VERSION, reason: validation.reason, goal });
    const steps = desktop.steps.map((step, index) => toRuntimeStep(step, index, device_id));
    return Object.freeze({
      status: 'planned',
      version: VERSION,
      mission_type: 'desktop',
      goal: desktop.goal,
      strategy: desktop.strategy,
      target: Object.freeze({ type: 'device', device_id }),
      constraints: desktop.constraints,
      steps: Object.freeze(steps)
    });
  }

  return Object.freeze({ version: VERSION, plan });
}

module.exports = Object.freeze({ VERSION, DEFAULT_DEVICE_ID, READ_ACTIONS, LOW_WRITE_ACTIONS, riskForComputerAction, inferVerify, createDesktopMissionPlanner });
