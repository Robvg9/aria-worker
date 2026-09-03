'use strict';

function createStopController() {
  let stopped = false; let reason = null;
  return Object.freeze({
    stop(value = 'manual_stop') { stopped = true; reason = String(value); return { stopped, reason }; },
    isStopped() { return stopped; },
    reason() { return reason; },
    snapshot() { return { stopped, reason }; }
  });
}

module.exports = { createStopController };
