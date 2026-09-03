'use strict';

const coreIdentity = require('../core/identity');
const session = require('../session/manager');
const planning = require('../planning/planner');
const taskState = require('../tasks/state-machine');
const selfState = require('../self/state');
const toolUniverse = require('../tool-universe/registry');
const execution = require('../execution/lookup');
const selfDevelopment = require('../self-development/coordinator');
const autonomy = require('../autonomy/coordinator');
const multiIA = require('../multi-ia/coordinator');
const agents = require('../agents/coordinator');
const platform = require('../platform/coordinator');
const { createActivationRuntime } = require('./runtime');
const { version } = require('../package.json');

function createAriaRuntime(options = {}) {
  const activation = createActivationRuntime(options.activation || {});
  return Object.freeze({
    identity: coreIdentity,
    core: { session, planning, taskState, selfState },
    tools: toolUniverse,
    execution,
    selfDevelopment,
    autonomy,
    multiIA,
    agents,
    platform,
    activation,
    version
  });
}

module.exports = { createAriaRuntime };
