'use strict';

const { verifyDesktopResult } = require('./desktop-semantic-verifier');

const VERSION = 'aria-desktop-semantic-runtime-v1';

function createDesktopSemanticRuntimeVerifier({ deviceDispatcher, baseVerify = null } = {}) {
  if (!deviceDispatcher || typeof deviceDispatcher.execute !== 'function') {
    throw new TypeError('deviceDispatcher.execute function required');
  }
  if (baseVerify !== null && typeof baseVerify !== 'function') {
    throw new TypeError('baseVerify function required');
  }

  async function verify({ missionId, mission, step, result, attempt = 1, ...context } = {}) {
    if (baseVerify) {
      const base = await baseVerify({ missionId, mission, step, result, attempt, ...context });
      if (base !== true) return base;
    }

    if (step?.operation !== 'computer.use') {
      return true;
    }

    if (result?.status && !['succeeded', 'completed'].includes(result.status)) {
      return false;
    }

    const input = step.input && typeof step.input === 'object' ? step.input : {};
    if (input.action === 'observe') {
      return result?.status === 'succeeded' || result?.status === 'completed';
    }

    const deviceId = step.target?.device_id || step.policy?.device_id;
    if (!deviceId) return false;

    const observationStep = {
      id: `${step.id || 'desktop_step'}_verify`,
      operation: 'computer.use',
      executor_type: 'device',
      target: { type: 'device', device_id: deviceId },
      input: { action: 'observe' },
      policy: { desktop_governed: true, risk_class: 'READ' },
      timeout_ms: Number.isInteger(step.timeout_ms) ? step.timeout_ms : 120000
    };

    const observationResult = await deviceDispatcher.execute({
      missionId,
      step: observationStep,
      attempt,
      policy: observationStep.policy,
      request: { semantic_verification: true }
    });

    if (!observationResult || !['succeeded', 'completed'].includes(observationResult.status)) {
      return Object.freeze({
        ok: false,
        reason: 'observation_failed',
        version: VERSION,
        observation_status: observationResult?.status || null
      });
    }

    const observation = observationResult.observation || observationResult.ui || observationResult;
    return verifyDesktopResult({ step, result, observation });
  }

  return Object.freeze({ VERSION, verify });
}

module.exports = Object.freeze({ VERSION, createDesktopSemanticRuntimeVerifier });
