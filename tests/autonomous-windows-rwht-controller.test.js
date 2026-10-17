'use strict';

const assert = require('node:assert/strict');
const { runAutonomousRwht, capabilityProfile } = require('../agents/windows/autonomous-rwht-controller');

(async () => {
  let phase = 'initial';
  const calls = [];
  const uiInitial = {
    surface: 'windows-desktop',
    title: 'BattleCruiser',
    nodes: [{
      id: 'btn-dashboard',
      role: 'button',
      name: 'Dashboard',
      label: 'Dashboard',
      text: 'Dashboard',
      enabled: true,
      visible: true,
      attributes: { x: 100, y: 100, width: 120, height: 40 }
    }],
    metadata: { source: 'test' }
  };
  const uiAfter = {
    ...uiInitial,
    title: 'BattleCruiser Dashboard',
    nodes: []
  };

  const adapter = async (request) => {
    calls.push(request);
    if (request.action === 'observe') {
      return { status: 'succeeded', action: 'observe', ui: phase === 'initial' ? uiInitial : uiAfter };
    }
    if (request.action === 'click') {
      phase = 'after-click';
      return { status: 'succeeded', action: 'click' };
    }
    if (request.action === 'screenshot') {
      return { status: 'succeeded', action: 'screenshot', screenshot_base64: 'TEST_SCREENSHOT' };
    }
    if (request.action === 'wait') return { status: 'succeeded', action: 'wait' };
    if (request.action === 'focus') return { status: 'succeeded', action: 'focus' };
    if (request.action === 'hotkey') return { status: 'succeeded', action: 'hotkey' };
    if (request.action === 'type') return { status: 'succeeded', action: 'type' };
    return { status: 'succeeded', action: request.action };
  };

  const progress = [];
  let modelCalls = 0;
  const model = async () => {
    modelCalls += 1;
    return modelCalls === 1
      ? '{"action":"click","node_id":"btn-dashboard","reason":"abrir Dashboard"}'
      : '{"action":"finish","reason":"cobertura inicial verificada"}';
  };

  const result = await runAutonomousRwht({
    mission_id: 'rwht-controller-test',
    goal: 'Ejecutar RWHT de BattleCruiser desde PC',
    device_id: 'windows-test',
    adapter,
    model,
    start_url: null,
    max_actions: 5,
    max_runtime_ms: 30000,
    capture_screenshots: false,
    on_progress: async (event) => { progress.push(event); }
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.verified, true);
  assert.equal(result.actions_verified >= 1, true);
  assert.equal(modelCalls >= 1, true);
  assert.equal(calls.some((c) => c.action === 'click'), true);
  assert.equal(result.capability_awareness.capabilities.some((c) => c.operation === 'computer.use.autonomous'), true);
  assert.equal(capabilityProfile('windows-test').capabilities.some((c) => c.operation === 'ollama.qwen3'), true);
  const progressTypes = new Set(progress.map((event) => event.event_type));
  for (const type of [
    'computer_use_capabilities_confirmed',
    'computer_use_device_confirmed',
    'computer_use_observation_started',
    'computer_use_observation_completed',
    'computer_use_decision_made',
    'computer_use_action_started',
    'computer_use_action_executed',
    'computer_use_result_observed',
    'computer_use_verification_completed'
  ]) assert.equal(progressTypes.has(type), true, 'missing live progress event: ' + type);

  const revoked = new AbortController();
  let revokedObservations = 0;
  let revokedClicks = 0;
  const revokedAdapter = async (request, options = {}) => {
    assert.equal(options.signal, revoked.signal, 'mission cancellation signal must reach every physical adapter call');
    if (request.action === 'observe') {
      revokedObservations += 1;
      return { status: 'succeeded', action: 'observe', ui: uiInitial };
    }
    if (request.action === 'click') {
      revokedClicks += 1;
      revoked.abort();
      return { status: 'succeeded', action: 'click' };
    }
    return { status: 'succeeded', action: request.action };
  };
  await assert.rejects(
    runAutonomousRwht({
      mission_id: 'rwht-controller-revocation-test',
      goal: 'RWHT_CONTROL_DISCOVERY_VERIFY cancellation regression',
      device_id: 'windows-test',
      adapter: revokedAdapter,
      start_url: null,
      max_actions: 5,
      max_runtime_ms: 30000,
      capture_screenshots: false,
      signal: revoked.signal,
      on_progress: async () => {}
    }),
    /mission_authorization_revoked/
  );
  assert.equal(revokedObservations, 1, 'RWHT must not observe or act again after mission revocation');
  assert.equal(revokedClicks, 1, 'RWHT must stop immediately after the in-flight action receives revocation');

  console.log('AUTONOMOUS WINDOWS RWHT CONTROLLER: PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
