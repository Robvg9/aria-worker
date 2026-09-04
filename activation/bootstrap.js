'use strict';

const coreIdentity = require('../core/identity');
const session = require('../session/manager');
const planning = require('../planning/planner');
const taskState = require('../tasks/state-machine');
const selfState = require('../self/state');
const toolUniverse = require('../tool-universe/registry');
const execution = require('../execution/lookup');
const missionState = require('../execution/mission-state');
const deviceDispatcher = require('../execution/device-dispatcher');
const { createSupabaseMissionRepository } = require('../execution/supabase-mission-repository');
const { createAutonomousRuntime } = require('../autonomy/autonomous-runtime');
const selfDevelopment = require('../self-development/coordinator');
const autonomy = require('../autonomy/coordinator');
const autonomousMission = require('../autonomy/orchestrator');
const universalExecutor = require('../autonomy/universal-executor');
const universalMission = require('../autonomy/universal-mission');
const multiIA = require('../multi-ia/coordinator');
const agents = require('../agents/coordinator');
const platform = require('../platform/coordinator');
const { createGovernanceAuthorizer } = require('./governance');
const { createActivationRuntime } = require('./runtime');
const { version } = require('../package.json');

function createAriaRuntime(options = {}) {
  const governanceOptions = options.governance || {};
  const governanceAuthorize = governanceOptions.approvalStore
    ? createGovernanceAuthorizer(governanceOptions)
    : null;
  const activationOptions = { ...(options.activation || {}) };
  if (!activationOptions.authorize && governanceAuthorize) activationOptions.authorize = governanceAuthorize;
  const activation = createActivationRuntime(activationOptions);

  return Object.freeze({
    identity: coreIdentity,
    core: { session, planning, taskState, selfState },
    tools: toolUniverse,
    execution: Object.freeze({ ...execution, missionState, deviceDispatcher, createSupabaseMissionRepository }),
    selfDevelopment,
    autonomy: Object.freeze({
      coordinator: autonomy,
      missionOrchestrator: autonomousMission,
      universalExecutor,
      universalMission,
      createAutonomousRuntime: runtimeOptions => createAutonomousRuntime({ activation, ...runtimeOptions })
    }),
    multiIA,
    agents,
    platform,
    governance: Object.freeze({ authorize: governanceAuthorize }),
    activation,
    version
  });
}

module.exports = { createAriaRuntime };
