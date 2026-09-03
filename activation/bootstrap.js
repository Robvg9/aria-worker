'use strict';

const coreIdentity = require('../core/identity');
const toolUniverse = require('../tool-universe/registry');
const execution = require('../execution/lookup');
const selfDevelopment = require('../self-development/coordinator');
const autonomy = require('../autonomy/coordinator');
const multiIA = require('../multi-ia/coordinator');
const agents = require('../agents/coordinator');
const platform = require('../platform/coordinator');
const { createActivationRuntime } = require('./runtime');

function optionalRequire(path) {
  try { return require(path); } catch (_) { return null; }
}

function createAriaRuntime(options = {}) {
  const activation = createActivationRuntime(options.activation || {});
  return Object.freeze({
    identity: coreIdentity,
    core: {
      session: optionalRequire('../core/session'),
      planning: optionalRequire('../core/planning'),
      taskState: optionalRequire('../core/task-state'),
      selfState: optionalRequire('../core/self-state')
    },
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
