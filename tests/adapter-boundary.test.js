'use strict';

const assert = require('assert');
const { adapt } = require('../mcp-gateway/adapter');

const base = {
  adapter_id: 'github-mcp', protocol: 'mcp', request_id: 'r1', task_id: 't1', execution_id: 'e1',
  authorization_id: 'a1', tool_id: 'github', operation: 'read_repo', input: { repo: 'x' }, risk_class: 'READ'
};

const cases = [
  () => assert.strictEqual(adapt(base).status, 'blocked'),
  () => assert.strictEqual(adapt(base).error_code, 'live_dispatch_disabled'),
  () => assert.strictEqual(adapt({ ...base, protocol: 'ftp' }).reason, 'unsupported_protocol'),
  () => assert.strictEqual(adapt({ ...base, authorization_id: '' }).reason, 'missing_authorization'),
  () => assert.strictEqual(adapt({ ...base, execution_id: '' }).reason, 'missing_execution_id'),
  () => assert.strictEqual(adapt({ ...base, operation: '' }).reason, 'missing_operation'),
  () => assert.strictEqual(adapt({ ...base, input: null }).reason, 'missing_input'),
  () => assert.strictEqual(adapt({ ...base, risk_class: 'UNKNOWN' }).reason, 'invalid_risk_class'),
  () => assert.strictEqual(adapt({ ...base, adapter_id: '' }).reason, 'missing_adapter_id'),
  () => assert.strictEqual(adapt({ ...base, request_id: '' }).reason, 'missing_request_id'),
  () => assert.strictEqual(adapt({ ...base, tool_id: '' }).reason, 'missing_tool_id'),
  () => assert.strictEqual(adapt({ ...base, result: { api_key: 'secret' } }).status, 'blocked'),
  () => assert.strictEqual(adapt({ ...base, protocol: 'api' }).adapter_id, 'github-mcp'),
  () => assert.strictEqual(Object.prototype.hasOwnProperty.call(adapt(base), 'approved_to_execute'), false),
  () => assert.strictEqual(Object.prototype.hasOwnProperty.call(adapt(base), 'network_call'), false)
];

cases.forEach((test, i) => { test(); console.log(`PASS case-${i + 1}`); });
console.log(`\n${cases.length}/${cases.length} Adapter boundary tests passed`);
