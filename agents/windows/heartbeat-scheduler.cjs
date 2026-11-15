'use strict';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_RETRY_BASE_MS = 2_000;
const DEFAULT_RETRY_MAX_MS = 15_000;

async function runHeartbeatLoop({
  sendHeartbeat,
  shouldStop,
  sleep,
  intervalMs = DEFAULT_INTERVAL_MS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_RETRY_MAX_MS,
  onRetry = () => {}
}) {
  if (typeof sendHeartbeat !== 'function') throw new TypeError('sendHeartbeat must be a function');
  if (typeof shouldStop !== 'function') throw new TypeError('shouldStop must be a function');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
  for (const [name, value] of Object.entries({ intervalMs, retryBaseMs, retryMaxMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(name + ' must be a positive finite number');
  }

  let consecutiveFailures = 0;
  while (!shouldStop()) {
    let succeeded = false;
    try {
      succeeded = (await sendHeartbeat()) === true;
    } catch {
      succeeded = false;
    }

    if (succeeded) {
      consecutiveFailures = 0;
      await sleep(intervalMs);
      continue;
    }

    consecutiveFailures = Math.min(consecutiveFailures + 1, 16);
    const delayMs = Math.min(retryMaxMs, retryBaseMs * (2 ** (consecutiveFailures - 1)));
    try {
      onRetry({ consecutiveFailures, delayMs });
    } catch {
      // Telemetry callbacks must not stop the heartbeat loop.
    }
    await sleep(delayMs);
  }

  return { consecutiveFailures };
}

module.exports = {
  runHeartbeatLoop,
  DEFAULT_INTERVAL_MS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS
};
