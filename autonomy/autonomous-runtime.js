'use strict';

const { createUniversalMissionRunner } = require('./universal-mission');
const { createMissionEntrypoint } = require('./mission-entrypoint');
const { createMissionHttpHandler } = require('./mission-http');
const { createDeviceDispatcher } = require('../execution/device-dispatcher');
const { createSupabaseMissionRepository } = require('../execution/supabase-mission-repository');
const { createMissionStateStore } = require('../execution/mission-state');
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

  const missionRepository = createSupabaseMissionRepository({ supabaseUrl, serviceRoleKey });
  const missionStore = createMissionStateStore(missionRepository);
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

  const entrypoint = createMissionEntrypoint({
    missionStore,
    runMission: mission.run
  });

  const http = createMissionHttpHandler({
    startMission: entrypoint.startMission,
    auth: device.auth || null
  });

  return Object.freeze({
    missionRepository,
    missionStore,
    deviceClient,
    deviceDispatcher,
    executor: mission.executor,
    orchestrator: mission.orchestrator,
    runMission: mission.run,
    startMission: entrypoint.startMission,
    missionHttp: http
  });
}

module.exports = Object.freeze({ createAutonomousRuntime });
