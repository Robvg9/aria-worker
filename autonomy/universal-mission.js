'use strict';

const { createAutonomousMissionOrchestrator } = require('./orchestrator');
const { createUniversalExecutor } = require('./universal-executor');

function createUniversalMissionRunner({
  missionStore,
  planner,
  verify,
  activation,
  deviceDispatcher,
  agentExecutors = {},
  policy = {},
  now
} = {}) {
  const executor = createUniversalExecutor({
    activation,
    deviceDispatcher,
    agentExecutors
  });

  const orchestrator = createAutonomousMissionOrchestrator({
    missionStore,
    planner,
    executor,
    verify,
    policy,
    now
  });

  return Object.freeze({
    executor,
    orchestrator,
    run: orchestrator.run,
    policy: orchestrator.policy,
    limits: orchestrator.limits
  });
}

module.exports = Object.freeze({ createUniversalMissionRunner });
