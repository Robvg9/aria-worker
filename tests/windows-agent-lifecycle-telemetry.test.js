'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'aria-agent.js'), 'utf8');

function functionBody(name, nextName) {
  const start = source.indexOf(`async function ${name}(job)`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start);
  return source.slice(start, end === -1 ? source.length : end);
}

test('Windows agent never awaits non-critical meditation telemetry', () => {
  assert.equal((source.match(/await meditationController\.event/g) || []).length, 0);
  assert.match(source, /function emitTelemetry\(message\)/);
  assert.match(source, /ARIA_AGENT_HEARTBEAT_PATH/);
  assert.match(source, /touchProcessHeartbeat\('attempt'\)/);
});

for (const [name, nextName] of [
  ['executeShellJob','executeOllamaJob'],
  ['executeOllamaJob','executeAutonomousRwhtJob'],
  ['executeAutonomousRwhtJob','executeComputerUseJob'],
  ['executeComputerUseJob','claimAndExecute']
]) {
  test(`${name} persists job lifecycle before telemetry`, () => {
    const body = functionBody(name, nextName);
    const received = body.indexOf('emitTelemetry(`JOB RECEIVED');
    const start = body.indexOf('/start');
    const result = body.indexOf('/result');
    const resultTelemetry = body.indexOf('emitTelemetry(`JOB RESULT');
    assert.ok(start >= 0 && received > start, 'JOB RECEIVED telemetry must not precede /start');
    assert.ok(result >= 0 && resultTelemetry > result, 'JOB RESULT telemetry must not precede /result');
  });
}

test('Windows watchdog restarts a live agent whose process heartbeat becomes stale', () => {
  const watchdog = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows', 'run-agent.ps1'), 'utf8');
  assert.match(watchdog, /ARIA_AGENT_HEARTBEAT_PATH/);
  assert.match(watchdog, /\$env:ARIA_AGENT_HEARTBEAT_PATH = \$HeartbeatPath/);
  assert.match(watchdog, /AGENT_STALE_HEARTBEAT/);
  assert.match(watchdog, /AgentHeartbeatStaleSeconds/);
  assert.match(watchdog, /Stop-Process -Id \$process\.Id -Force/);
});
