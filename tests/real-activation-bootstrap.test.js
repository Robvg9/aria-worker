'use strict';

const assert = require('node:assert/strict');
const { createAriaRuntime } = require('../activation/bootstrap');

(() => {
  const aria = createAriaRuntime({ activation:{ env:{}, fetchImpl:async()=>({ok:true,status:200,text:async()=>'{"ok":true}'}) } });
  assert.equal(aria.version, '2.4.0');
  assert.equal(aria.identity.getIdentity().id, 'aria');
  assert.equal(typeof aria.activation.probeAll, 'function');
  assert.equal(typeof aria.execution.execute, 'function');
  assert.equal(typeof aria.platform, 'object');
  assert.equal(typeof aria.autonomy, 'object');
  assert.equal(typeof aria.selfDevelopment, 'object');
  assert.equal(typeof aria.multiIA.runMultiIA, 'function');
  assert.equal(typeof aria.agents.runAgentDelegation, 'function');
  console.log('REAL ACTIVATION BOOTSTRAP PASS');
})();
