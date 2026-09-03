'use strict';

const coreIdentity = require('../core/identity');
const session = require('../core/session');
const planning = require('../core/planning');
const taskState = require('../core/task-state');
const selfState = require('../core/self-state');
const toolUniverse = require('../tool-universe/registry');
const execution = require('../execution/lookup');
const selfDevelopment = require('../self-development/coordinator');
const autonomy = require('../autonomy/coordinator');
const multiIA = require('../multi-ia/coordinator');
const agents = require('../agents/coordinator');
const platform = require('../platform/coordinator');
const { createActivationRuntime } = require('./runtime');

function createAriaRuntime(options = {}) {
  const activation = createActivationRuntime(options.activation || {});
  return Object.freeze({
    identity: coreIdentity,
    session,
    planning,
    taskState,
    selfState,
    tools: toolUniverse,
    execution,
    selfDevelopment,
    autonomy,
    multiIA,
    agents,
    platform,
    activation,
    version: '2.4.0'
  });
}

module.exports = { createAriaRuntime };
