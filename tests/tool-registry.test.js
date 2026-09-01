/**
 * Mission 10.9 — Tool Registry tests
 * Pure declarative checks. No network, no secrets, no execution.
 */
const assert = require('assert');
const tools = require('../tools/lookup.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL  ' + name + ': ' + (e && e.message));
  }
}

console.log('\n=== 10.9 Tool Registry ===');

test('version is aria-tool-registry-v1.0.0', () => {
  assert.strictEqual(tools.version, 'aria-tool-registry-v1.0.0');
});

test('listTools returns exactly 2 verified tools', () => {
  const list = tools.listTools();
  assert.strictEqual(list.length, 2);
});

test('listToolIds contains stable ids', () => {
  const ids = tools.listToolIds();
  assert.ok(ids.indexOf('tool_aria_context') !== -1);
  assert.ok(ids.indexOf('tool_aria_memory_capture') !== -1);
});

test('getTool returns aria_context with read risk', () => {
  const t = tools.getTool('tool_aria_context');
  assert.ok(t);
  assert.strictEqual(t.name, 'aria_context');
  assert.strictEqual(t.risk_level, 'read');
  assert.strictEqual(t.status, 'available');
  assert.strictEqual(t.interface_type, 'mcp');
  assert.ok(t.operations.indexOf('read') !== -1);
});

test('getTool returns aria_memory_capture with low_risk_write', () => {
  const t = tools.getTool('tool_aria_memory_capture');
  assert.ok(t);
  assert.strictEqual(t.name, 'aria_memory_capture');
  assert.strictEqual(t.risk_level, 'low_risk_write');
  assert.strictEqual(t.status, 'available');
  assert.ok(t.operations.indexOf('write_candidate') !== -1);
});

test('getTool unknown id returns null', () => {
  assert.strictEqual(tools.getTool('tool_nonexistent'), null);
  assert.strictEqual(tools.getTool(null), null);
  assert.strictEqual(tools.getTool(''), null);
});

test('getToolByMcpName resolves aria_context', () => {
  const t = tools.getToolByMcpName('aria_context');
  assert.ok(t);
  assert.strictEqual(t.tool_id, 'tool_aria_context');
});

test('getToolByMcpName resolves aria_memory_capture', () => {
  const t = tools.getToolByMcpName('aria_memory_capture');
  assert.ok(t);
  assert.strictEqual(t.tool_id, 'tool_aria_memory_capture');
});

test('isAvailable true for verified tools', () => {
  assert.strictEqual(tools.isAvailable('tool_aria_context'), true);
  assert.strictEqual(tools.isAvailable('tool_aria_memory_capture'), true);
});

test('isAvailable false for unknown', () => {
  assert.strictEqual(tools.isAvailable('tool_nonexistent'), false);
});

test('supportsOperation read on aria_context', () => {
  assert.strictEqual(tools.supportsOperation('tool_aria_context', 'read'), true);
  assert.strictEqual(tools.supportsOperation('tool_aria_context', 'write_candidate'), false);
});

test('supportsOperation write_candidate on aria_memory_capture', () => {
  assert.strictEqual(tools.supportsOperation('tool_aria_memory_capture', 'write_candidate'), true);
  assert.strictEqual(tools.supportsOperation('tool_aria_memory_capture', 'read'), false);
});

test('toolsByProvider aria returns both', () => {
  const list = tools.toolsByProvider('aria');
  assert.strictEqual(list.length, 2);
});

test('toolsByProvider unknown returns empty', () => {
  assert.strictEqual(tools.toolsByProvider('nonexistent').length, 0);
});

test('toolsByRisk read returns aria_context', () => {
  const list = tools.toolsByRisk('read');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].tool_id, 'tool_aria_context');
});

test('toolsByRisk low_risk_write returns aria_memory_capture', () => {
  const list = tools.toolsByRisk('low_risk_write');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].tool_id, 'tool_aria_memory_capture');
});

test('riskOf returns correct levels', () => {
  assert.strictEqual(tools.riskOf('tool_aria_context'), 'read');
  assert.strictEqual(tools.riskOf('tool_aria_memory_capture'), 'low_risk_write');
  assert.strictEqual(tools.riskOf('missing'), null);
});

test('no secrets in registry JSON string', () => {
  const raw = JSON.stringify(tools.registry);
  assert.ok(!/sk-|or-v1-|Bearer |api[_-]?key|password|token\s*[:=]/i.test(raw));
});

test('memory_authority is false', () => {
  assert.strictEqual(tools.registry.memory_authority, false);
});

test('no invented third-party tools marked available', () => {
  const available = tools.listTools().filter(t => t.status === 'available');
  for (const t of available) {
    assert.ok(t.provider_id === 'aria', 'only aria tools may be available in seed');
  }
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
