'use strict';

const VERSION = 'aria-desktop-mission-replanner-v1.2';
const NON_RETRYABLE = new Set(['risk_blocked', 'executor_target_missing', 'operation_not_registered', 'computer_action_not_allowed', 'shell_policy_blocked', 'open_payload_invalid', 'focus_payload_invalid']);

function cloneStep(step, overrides = {}) {
  return Object.freeze({
    ...step,
    ...overrides,
    target: overrides.target ? Object.freeze({ ...overrides.target }) : (step.target ? Object.freeze({ ...step.target }) : step.target),
    input: overrides.input ? Object.freeze({ ...overrides.input }) : step.input,
    policy: step.policy ? Object.freeze({ ...step.policy }) : step.policy,
    depends_on: []
  });
}

function failureCode(outcome = {}) {
  return outcome?.verification?.reason || outcome?.result?.verification?.reason || outcome?.result?.error?.code || outcome?.error || null;
}

function createDesktopMissionReplanner({ max_alternatives = 2 } = {}) {
  if (!Number.isInteger(max_alternatives) || max_alternatives < 1 || max_alternatives > 4) throw new TypeError('max_alternatives must be 1..4');

  async function replan({ failed_step, outcome, replan_count = 0, mission = {} } = {}) {
    if (!failed_step || typeof failed_step !== 'object') throw new TypeError('failed_step required');
    const code = failureCode(outcome);
    if (code && NON_RETRYABLE.has(code)) return Object.freeze([]);

    const operation = String(failed_step.operation || '');
    const input = failed_step.input && typeof failed_step.input === 'object' ? failed_step.input : {};
    const deviceId = failed_step.target?.device_id || mission?.target?.device_id || 'windows-local';
    const alternatives = [];

    alternatives.push(cloneStep(failed_step, {
      id: `${failed_step.id || 'desktop_step'}_reobserve_${replan_count + 1}`,
      operation: 'computer.use',
      input: { action: 'observe' },
      target: { type: 'device', device_id: deviceId },
      risk: 'READ',
      retryable: false,
      verify: {}
    }));

    if (operation === 'computer.use' && input.action === 'focus' && input.process) {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_refocus_${replan_count + 1}`,
        input: { action: 'focus', process: input.process },
        target: { type: 'device', device_id: deviceId },
        risk: 'READ'
      }));
    } else if (operation === 'computer.use' && input.action === 'type') {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_refocus_${replan_count + 1}`,
        input: { action: 'focus', process: input.process || 'powershell' },
        target: { type: 'device', device_id: deviceId },
        risk: 'READ',
        verify: { focused_process: input.process || 'powershell' }
      }));
    } else if (operation === 'computer.use' && input.action === 'open' && input.path) {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_reopen_${replan_count + 1}`,
        input: { action: 'open', path: input.path },
        target: { type: 'device', device_id: deviceId },
        risk: 'LOW_RISK_WRITE'
      }));
    } else if (operation === 'shell.execute') {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_verify_shell_${replan_count + 1}`,
        operation: 'computer.use',
        input: { action: 'observe' },
        target: { type: 'device', device_id: deviceId },
        risk: 'READ',
        retryable: false,
        verify: {}
      }));
    }

    const deduped = [];
    const seen = new Set();
    for (const step of alternatives) {
      const key = JSON.stringify({ operation: step.operation, input: step.input, target: step.target });
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(step);
      if (deduped.length >= max_alternatives) break;
    }
    return Object.freeze(deduped);
  }

  return Object.freeze({ VERSION, replan });
}

module.exports = Object.freeze({ VERSION, NON_RETRYABLE, createDesktopMissionReplanner });
