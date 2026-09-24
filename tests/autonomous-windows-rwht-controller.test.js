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
    capture_screenshots: false
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.verified, true);
  assert.equal(result.actions_verified >= 1, true);
  assert.equal(modelCalls >= 1, true);
  assert.equal(calls.some((c) => c.action === 'click'), true);
  assert.equal(result.capability_awareness.capabilities.some((c) => c.operation === 'computer.use.autonomous'), true);
  assert.equal(capabilityProfile('windows-test').capabilities.some((c) => c.operation === 'ollama.qwen3'), true);

  console.log('AUTONOMOUS WINDOWS RWHT CONTROLLER: PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
