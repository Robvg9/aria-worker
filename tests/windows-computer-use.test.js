'use strict';

const assert = require('node:assert/strict');
const { validateDeviceJobOperation, COMPUTER_USE_ACTIONS } = require('../execution/device-job-contract');
const { validateRequest, VERSION, ACTIONS } = require('../computer-use/windows-desktop-adapter');

assert.equal(COMPUTER_USE_ACTIONS.has('screenshot'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('click'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('type'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('open'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('observe'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('focus'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('keypress'), true);
assert.equal(COMPUTER_USE_ACTIONS.has('scroll'), true);

assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'screenshot' })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'click', x: 10, y: 20 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'type', text: 'ARIA' })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'unknown' })).ok, false);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'click', x: '10', y: 20 })).ok, false);

assert.deepEqual(validateRequest({ action: 'screenshot' }).action, 'screenshot');
assert.throws(() => validateRequest({ action: 'click', x: 1 }), /desktop_click_invalid/);
assert.throws(() => validateRequest({ action: 'type', text: '' }), /desktop_type_invalid/);
assert.throws(() => validateRequest({ action: 'open' }), /desktop_open_invalid/);
assert.throws(() => validateRequest({ action: 'focus' }), /desktop_focus_invalid/);
assert.throws(() => validateRequest({ action: 'keypress' }), /desktop_keypress_invalid/);
assert.throws(() => validateRequest({ action: 'scroll' }), /desktop_scroll_invalid/);

assert.ok(VERSION.startsWith('aria-windows-desktop-v1'));
assert.ok(VERSION.includes('v1.6') || /v1\.\d+/.test(VERSION));
assert.equal(ACTIONS.has('screenshot'), true);

// Adapter source must force STA and dual capture path (contract against regression).
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'windows-desktop-adapter.js'), 'utf8');
assert.match(src, /-STA/);
assert.match(src, /BitBlt/);
assert.match(src, /SetProcessDPIAware/);
assert.match(src, /FromHbitmap/);
assert.match(src, /CopyFromScreen/);
// Guard against the PS 5.1 ArgumentList array packing bug.
assert.doesNotMatch(src, /New-Object System\.Drawing\.Bitmap -ArgumentList @/);

console.log('WINDOWS COMPUTER USE CONTRACT: PASS');
