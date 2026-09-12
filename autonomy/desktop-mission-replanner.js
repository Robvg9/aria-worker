'use strict';

const VERSION = 'aria-desktop-mission-replanner-v1';

function cloneStep(step, overrides = {}) {
  return Object.freeze({
    ...step,
    ...overrides,
    target: step.target ? Object.freeze({ ...step.target }) : step.target,
    input: overrides.input ? Object.freeze({ ...overrides.input }) : step.input,
    policy: step.policy ? Object.freeze({ ...step.policy }) : step.policy,
    depends_on: []
  });
}

function createDesktopMissionReplanner({ max_alternatives = 2 } = {}) {
  if (!Number.isInteger(max_alternatives) || max_alternatives < 1 || max_alternatives > 4) {
    throw new TypeError('max_alternatives must be 1..4');
  }

  async function replan({ failed_step, outcome, completed_steps = [], replan_count = 0 } = {}) {
    if (!failed_step || typeof failed_step !== 'object') throw new TypeError('failed_step required');

    const current = String(failed_step.operation || '');
    const input = failed_step.input && typeof failed_step.input === 'object' ? failed_step.input : {};
    const alternatives = [];

    // Always re-observe before trying another state-changing action.
    alternatives.push({
      ...cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_reobserve_${replan_count + 1}`,
        operation: 'computer.use',
        input: { action: 'observe' },
        risk: 'read',
        retryable: false
      })
    });

    if (current === 'computer.use' && input.action === 'focus' && input.process) {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_refocus_${replan_count + 1}`,
        input: { action: 'focus', process: input.process }
      }));
    } else if (current === 'computer.use' && input.action === 'type') {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_refocus_${replan_count + 1}`,
        input: { action: 'focus', process: 'powershell' }
      }));
    } else if (current === 'computer.use' && input.action === 'open' && input.target) {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_reopen_${replan_count + 1}`,
        input: { action: 'open', path: input.target }
      }));
    } else if (current === 'shell.execute') {
      alternatives.push(cloneStep(failed_step, {
        id: `${failed_step.id || 'desktop_step'}_verify_shell_${replan_count + 1}`,
        operation: 'computer.use',
        input: { action: 'observe' },
        risk: 'read'
      }));
    }

    const deduped = [];
    const seen = new Set();
    for (const step of alternatives) {
      if (seen.has(JSON.stringify({ operation: step.operation, input: step.input }))) continue;
      seen.add(JSON.stringify({ operation: step.operation, input: step.input }));
      deduped.push(step);
      if (deduped.length >= max_alternatives) break;
    }

    return Object.freeze(deduped);
  }

  return Object.freeze({ VERSION, replan });
}

module.exports = Object.freeze({ VERSION, createDesktopMissionReplanner });
