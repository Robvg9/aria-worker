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
  desktopPlanner = null,
  replanner = null,
  verify,
  device = {},
  agentExecutors = {},
  policy = {},
  now
} = {}) {
  if (!activation || typeof activation.execute !== 'function') throw new TypeError('activation runtime required');
  if (typeof planner !== 'function' && (!desktopPlanner || typeof desktopPlanner.plan !== 'function')) throw new TypeError('planner function required');
  if (desktopPlanner !== null && (typeof desktopPlanner !== 'object' || typeof desktopPlanner.plan !== 'function')) throw new TypeError('desktopPlanner.plan function required');
  if (typeof verify !== 'function') throw new TypeError('verify function required');
  if (replanner !== null && typeof replanner !== 'function') throw new TypeError('replanner function required');

  const missionRepository = createSupabaseMissionRepository({ supabaseUrl, serviceRoleKey });
  const missionStore = createMissionStateStore(missionRepository);
  const deviceClient = createServiceDeviceClient({ supabaseUrl, serviceRoleKey, fetchImpl: device.fetchImpl });
  const deviceDispatcher = createDeviceDispatcher({ enqueue: deviceClient.enqueue, get: deviceClient.get, sleep: deviceClient.sleep, poll_ms: device.poll_ms, wait_ms: device.wait_ms });
  const effectivePlanner = desktopPlanner ? (input => desktopPlanner.plan({ goal: input.mission?.goal, constraints: input.policy || {} })) : planner;

  const mission = createUniversalMissionRunner({
    missionStore,
    planner: effectivePlanner,
    replanner,
    verify,
    activation,
    deviceDispatcher,
    agentExecutors,
    policy,
    now
  });

  const entrypoint = createMissionEntrypoint({ missionStore, runMission: mission.run });
  const http = createMissionHttpHandler({ startMission: entrypoint.startMission, auth: device.auth || null });

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
