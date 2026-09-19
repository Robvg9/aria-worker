'use strict';
const assert = require('node:assert/strict');
const { createUiState, planAction, verifyObservation, createComputerRuntime } = require('../computer-use/runtime-v1');

const ui = createUiState({
  surface: 'android-browser',
  url: 'https://example.test',
  title: 'Example',
  nodes: [
    { id: 'search', role: 'textbox', name: 'Search' },
    { id: 'login', role: 'button', name: 'Login' }
  ]
});

const planned = planAction({
  id: 'm1-a1',
  intent: 'Open login',
  ui,
  preferredTarget: { role: 'button', name: 'Login', action: 'click' }
});
assert.equal(planned.status, 'planned');
assert.equal(planned.action.target.ref, 'login');

const navigation = planAction({
  id: 'm1-nav',
  intent: 'Open canonical PWA',
  ui,
  preferredTarget: { action: 'navigate', value: { url: 'https://aria.robvg9.workers.dev/pwa/' } }
});
assert.equal(navigation.status, 'planned');
assert.equal(navigation.action.action, 'navigate');
assert.equal(navigation.action.target, null);
assert.equal(navigation.action.value.url, 'https://aria.robvg9.workers.dev/pwa/');

const secureType = planAction({
  id: 'm1-secure-type',
  intent: 'Type password using governed credential reference',
  ui: createUiState({
    surface: 'android-browser',
    nodes: [{ id: 'password', role: 'textbox', name: 'Contraseña', label: 'Contraseña' }]
  }),
  preferredTarget: {
    role: 'textbox',
    name: 'Contraseña',
    action: 'type',
    metadata: { credential_ref: 'secret://rwht/rwht_android_password' }
  }
});
assert.equal(secureType.status, 'planned');
assert.equal(secureType.action.metadata.credential_ref, 'secret://rwht/rwht_android_password');
assert.equal(secureType.action.text, null);

assert.equal(planAction({
  id: 'm1-a2', intent: 'Missing', ui,
  preferredTarget: { role: 'button', name: 'Missing', action: 'click' }
}).reason, 'element_not_found');

const after = createUiState({
  surface: 'android-browser',
  url: 'https://example.test/home',
  title: 'Home',
  nodes: [{ id: 'logout', role: 'button', name: 'Logout' }],
  metadata: { body_text: 'Welcome' }
});
assert.equal(verifyObservation({
  before: ui,
  after,
  expectation: { url: 'https://example.test/home', present: [{ role: 'button', name: 'Logout' }], text: 'Welcome' }
}).valid, true);

let executed = 0;
const adapter = {
  async observe() { return ui; },
  async execute({ action }) { executed += 1; assert.equal(action.target.ref, 'login'); return { status: 'succeeded', ui: after }; }
};
const runtime = createComputerRuntime({ adapter, learning: { recordSuccess() {}, recordFailure() {} } });

(async () => {
  const result = await runtime.executeMission({
    mission_id: 'android-browser-m1',
    intent: 'login',
    target: { role: 'button', name: 'Login', action: 'click' },
    expectation: { url: 'https://example.test/home' }
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(executed, 1);
  console.log('ANDROID BROWSER BRIDGE CONTRACT: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
