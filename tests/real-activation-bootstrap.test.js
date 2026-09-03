'use strict';

const assert = require('node:assert/strict');
const { createAriaRuntime } = require('../activation/bootstrap');

(() => {
  const aria = createAriaRuntime({ activation:{ env:{}, fetchImpl:async()=>({ok:true,status:200,text:async()=>'{"ok":true}'}) } });
  assert.equal(aria.version, require('../package.json').version);
  assert.equal(aria.identity.getIdentity().id, 'aria');
  assert.equal(typeof aria.activation.probeAll, 'function');
  assert.equal(typeof aria.execution.execute, 'function');
  assert.equal(typeof aria.platform, 'object');
  assert.equal(typeof aria.autonomy, 'object');
  assert.equal(typeof aria.selfDevelopment, 'object');
  assert.equal(typeof aria.multiIA.runMultiIA, 'function');
  assert.equal(typeof aria.agents.runAgentDelegation, 'function');
  assert.equal(typeof aria.core, 'object');
  assert.equal(typeof aria.core.session.createSessionManager, 'function');
  assert.equal(typeof aria.core.planning.makePlan, 'function');
  assert.equal(typeof aria.core.taskState.transition, 'function');
  assert.equal(typeof aria.core.selfState.createSelfStateProvider, 'function');

  const approvalStore = {
    async get() { return null; },
    async canExecute() { return false; }
  };
  const governed = createAriaRuntime({ governance:{ approvalStore } });
  assert.equal(typeof governed.governance.authorize, 'function');
  assert.equal(governed.activation.resolver !== undefined, true);

  console.log('REAL ACTIVATION BOOTSTRAP PASS');
})();
