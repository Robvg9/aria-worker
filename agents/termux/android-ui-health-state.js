'use strict';

const DEFAULT_FAILURE_TOLERANCE = 2;
const DEFAULT_MAX_STALE_MS = 180000;

function normalizeFailureStreak(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeTimestamp(value) {
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

function normalizeHealth(value) {
  return value && typeof value === 'object' ? { ...value, ok: value.ok === true } : { ok: false, reason: 'probe_not_run' };
}

function markAndroidUiExecutionSuccess(previous = {}, now = Date.now(), metadata = {}) {
  return {
    health: {
      ok: true,
      reason: 'android_execution_verified',
      payload: metadata.protocol ? { protocol: metadata.protocol } : (previous.health && previous.health.payload) || undefined,
      metadata: { ...((previous.health && previous.health.metadata) || {}), ...(metadata || {}), degraded: false }
    },
    failureStreak: 0,
    lastGoodAt: now
  };
}

function resolveAndroidUiHealth({
  previous = {},
  probe = { ok: false, reason: 'probe_not_run' },
  fallback = { ok: false, reason: 'fallback_not_run' },
  now = Date.now(),
  heartbeatMs = 60000,
  failureTolerance = DEFAULT_FAILURE_TOLERANCE,
  maxStaleMs = DEFAULT_MAX_STALE_MS
} = {}) {
  const previousHealth = normalizeHealth(previous.health);
  const previousLastGoodAt = normalizeTimestamp(previous.lastGoodAt);
  const previousFailures = normalizeFailureStreak(previous.failureStreak);
  const healthyProbe = normalizeHealth(probe);
  const healthyFallback = normalizeHealth(fallback);

  if (healthyProbe.ok) return { health: healthyProbe, failureStreak: 0, lastGoodAt: now };
  if (healthyFallback.ok) return { health: healthyFallback, failureStreak: 0, lastGoodAt: now };

  const failureStreak = previousFailures + 1;
  const hb = Math.max(30000, Number(heartbeatMs) || 60000);
  const graceMs = Math.max(Number(maxStaleMs) || DEFAULT_MAX_STALE_MS, hb * 2);
  const withinGrace = previousLastGoodAt > 0 && (now - previousLastGoodAt) < graceMs;
  const tolerance = Math.max(0, Number(failureTolerance) || DEFAULT_FAILURE_TOLERANCE);
  const keepLastKnownGood = previousHealth.ok && (failureStreak <= tolerance || withinGrace);

  if (keepLastKnownGood) {
    return {
      health: {
        ...previousHealth,
        ok: true,
        reason: 'android_ui_health_degraded_last_known_good:' + failureStreak,
        metadata: {
          ...(previousHealth.metadata || {}),
          degraded: true,
          failure_streak: failureStreak,
          probe_reason: healthyProbe.reason || null,
          fallback_reason: healthyFallback.reason || null
        }
      },
      failureStreak,
      lastGoodAt: previousLastGoodAt
    };
  }

  return {
    health: {
      ok: false,
      reason: healthyFallback.reason && healthyFallback.reason !== 'fallback_not_run' ? healthyFallback.reason : (healthyProbe.reason || 'android_ui_health_unavailable'),
      payload: healthyProbe.payload || healthyFallback.payload || null,
      metadata: {
        ...(healthyProbe.metadata || {}),
        ...(healthyFallback.metadata || {}),
        degraded: false,
        failure_streak: failureStreak
      }
    },
    failureStreak,
    lastGoodAt: previousLastGoodAt
  };
}

module.exports = Object.freeze({ DEFAULT_FAILURE_TOLERANCE, DEFAULT_MAX_STALE_MS, markAndroidUiExecutionSuccess, resolveAndroidUiHealth });
