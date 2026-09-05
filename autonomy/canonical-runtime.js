'use strict';

const { createAutonomousRuntime } = require('./autonomous-runtime');
const { createCognitiveMemory } = require('../memory/cognitive-memory');

/**
 * Canonical ARIA Runtime.
 *
 * This is the single supported composition boundary for autonomous missions.
 * Legacy callers may continue using createAutonomousRuntime during migration,
 * but new runtime integrations should enter through this module.
 */
function createCanonicalAriaRuntime(options = {}) {
  const {
    supabaseUrl,
    serviceRoleKey,
    memory = true,
    ...runtimeOptions
  } = options;

  const runtime = createAutonomousRuntime({
    ...runtimeOptions,
    supabaseUrl,
    serviceRoleKey
  });

  const cognitiveMemory = memory
    ? createCognitiveMemory({
        supabaseUrl,
        serviceRoleKey,
        fetchImpl: runtimeOptions.device?.fetchImpl || globalThis.fetch
      })
    : null;

  return Object.freeze({
    version: 'canonical-runtime-v1',
    missionRepository: runtime.missionRepository,
    missionStore: runtime.missionStore,
    deviceClient: runtime.deviceClient,
    deviceDispatcher: runtime.deviceDispatcher,
    executor: runtime.executor,
    orchestrator: runtime.orchestrator,
    runMission: runtime.runMission,
    startMission: runtime.startMission,
    missionHttp: runtime.missionHttp,
    cognitiveMemory
  });
}

module.exports = Object.freeze({ createCanonicalAriaRuntime });
