/**
 * ARIA Lifecycle helpers (Mission 10.11)
 */
const EXEC_STATES = ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'blocked'];
const GOV_STATES = ['pending_gate', 'approved', 'denied', 'blocked', 'expired', 'invalid'];

const EXEC_TRANSITIONS = {
  pending: ['running', 'blocked', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled', 'blocked'],
  succeeded: [],
  failed: [],
  cancelled: [],
  blocked: []
};

function isValidExecTransition(from, to) {
  if (!EXEC_TRANSITIONS[from]) return false;
  return EXEC_TRANSITIONS[from].indexOf(to) !== -1;
}

function isTerminalExec(state) {
  return ['succeeded', 'failed', 'cancelled', 'blocked'].indexOf(state) !== -1;
}

function isValidGovState(state) {
  return GOV_STATES.indexOf(state) !== -1;
}

module.exports = {
  version: 'aria-lifecycle-v1.0.0',
  EXEC_STATES,
  GOV_STATES,
  isValidExecTransition,
  isTerminalExec,
  isValidGovState
};
