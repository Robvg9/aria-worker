'use strict';

const { createAutonomousRuntime } = require('./autonomous-runtime');
const { createCognitiveMemory } = require('../memory/cognitive-memory');

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

/**
 * Canonical ARIA Runtime: the only supported composition boundary for new
 * autonomous runtime integrations. Legacy runtime remains compatible while
 * callers migrate to this surface.
 */
function createCanonicalAriaRuntime(options = {}) {
  const { supabaseUrl, serviceRoleKey, memory = true, ...runtimeOptions } = options;
  const runtime = createAutonomousRuntime({ ...runtimeOptions, supabaseUrl, serviceRoleKey });
  const cognitiveMemory = memory ? createCognitiveMemory({
    supabaseUrl,
    serviceRoleKey,
    fetchImpl: runtimeOptions.device?.fetchImpl || globalThis.fetch
  }) : null;

  async function runMission(input) {
    const result = await runtime.runMission(input);
    if (cognitiveMemory && result && typeof result === 'object') {
      const missionId = result.mission_id || result.missionId || input?.mission_id || input?.missionId || null;
      const status = result.status || 'unknown';
      const content = `Mission ${missionId || 'unknown'} completed with status=${status}. Result=${safeJson(result)}`;
      try {
        await cognitiveMemory.remember({
          memoryType: 'episodic',
          title: `Mission ${missionId || 'unknown'} outcome`,
          content,
          sourceType: 'mission',
          sourceRef: missionId,
          provenance: { runtime: 'canonical-runtime-v1', event: 'mission_completion' },
          metadata: { mission_id: missionId, status },
          confidence: status === 'succeeded' ? 1 : 0.8,
          importance: 0.7,
          salience: 0.8
        });
      } catch (_) {
        // Memory failure must never turn a completed mission into a failed mission.
      }
    }
    return result;
  }

  return Object.freeze({
    version: 'canonical-runtime-v1',
    missionRepository: runtime.missionRepository,
    missionStore: runtime.missionStore,
    deviceClient: runtime.deviceClient,
    deviceDispatcher: runtime.deviceDispatcher,
    executor: runtime.executor,
    orchestrator: runtime.orchestrator,
    runMission,
    startMission: runtime.startMission,
    missionHttp: runtime.missionHttp,
    cognitiveMemory
  });
}

module.exports = Object.freeze({ createCanonicalAriaRuntime });
