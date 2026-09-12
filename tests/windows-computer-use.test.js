'use strict';

const assert = require('node:assert/strict');
const { validateDeviceJobOperation, COMPUTER_USE_ACTIONS } = require('../execution/device-job-contract');
const { validateRequest, VERSION } = require('../computer-use/windows-desktop-adapter');

assert.equal(COMPUTER_USE_ACTIONS.has('screenshot'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('click'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('type'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('open'), true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'screenshot' })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'click', x: 10, y: 20 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'type', text: 'ARIA' })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'unknown' })).ok, false);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'click', x: '10', y: 20 })).ok, false);
assert.deepEqual(validateRequest({ action: 'screenshot' }).action, 'screenshot');
assert.throws(() => validateRequest({ action: 'click', x: 1 }), /desktop_click_invalid/);
assert.throws(() => validateRequest({ action: 'type', text: '' }), /desktop_type_invalid/);
assert.throws(() => validateRequest({ action: 'open' }), /desktop_open_invalid/);
assert.ok(VERSION.startsWith('aria-windows-desktop-v1'));

console.log('WINDOWS COMPUTER USE CONTRACT: PASS');
