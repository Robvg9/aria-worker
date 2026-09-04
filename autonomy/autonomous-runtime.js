'use strict';

const { createUniversalMissionRunner } = require('./universal-mission');
const { createDeviceDispatcher } = require('../execution/device-dispatcher');
const { createSupabaseMissionRepository } = require('../execution/supabase-mission-repository');
const { createServiceDeviceClient } = require('../execution/live-device-client');

function createAutonomousRuntime({
  supabaseUrl,
  serviceRoleKey,
  activation,
  planner,
  verify,
  device = {},
  agentExecutors = {},
  policy = {},
  now
} = {}) {
  if (!activation || typeof activation.execute !== 'function') throw new TypeError('activation runtime required');
  if (typeof planner !== 'function') throw new TypeError('planner function required');
  if (typeof verify !== 'function') throw new TypeError('verify function required');

  const missionStore = createSupabaseMissionRepository({ supabaseUrl, serviceRoleKey });
  const deviceClient = createServiceDeviceClient({
    supabaseUrl,
    serviceRoleKey,
    fetchImpl: device.fetchImpl
  });
  const deviceDispatcher = createDeviceDispatcher({
    enqueue: deviceClient.enqueue,
    get: deviceClient.get,
    sleep: device.sleep,
    poll_ms: device.poll_ms,
    wait_ms: device.wait_ms
  });

  const mission = createUniversalMissionRunner({
    missionStore,
    planner,
    verify,
    activation,
    deviceDispatcher,
    agentExecutors,
    policy,
    now
  });

  return Object.freeze({
    missionStore,
    deviceClient,
    deviceDispatcher,
    executor: mission.executor,
    orchestrator: mission.orchestrator,
    runMission: mission.run
  });
}

module.exports = Object.freeze({ createAutonomousRuntime });
