'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateDeviceJobOperation, COMPUTER_USE_ACTIONS } = require('../execution/device-job-contract');
const { validateRequest, VERSION, ACTIONS } = require('../computer-use/windows-desktop-adapter');

for (const action of [
  'screenshot','observe','open','click','double_click','move','drag',
  'type','keypress','hotkey','scroll','focus','wait'
]) assert.equal(COMPUTER_USE_ACTIONS.has(action), true);

assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'screenshot' })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'click', x: 10, y: 20 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'double_click', x: 10, y: 20 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'move', x: 10, y: 20 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'drag', x1: 10, y1: 20, x2: 100, y2: 200 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'type', text: 'ARIA' })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'hotkey', keys: ['CTRL','L'] })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'wait', ms: 100 })).ok, true);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'unknown' })).ok, false);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'click', x: '10', y: 20 })).ok, false);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'hotkey', keys: ['CTRL'] })).ok, false);
assert.equal(validateDeviceJobOperation('computer.use', JSON.stringify({ action: 'wait', ms: 60001 })).ok, false);

assert.deepEqual(validateRequest({ action: 'screenshot' }).action, 'screenshot');
assert.throws(() => validateRequest({ action: 'click', x: 1 }), /desktop_pointer_invalid/);
assert.throws(() => validateRequest({ action: 'drag', x1: 1, y1: 2, x2: 3 }), /desktop_drag_invalid/);
assert.throws(() => validateRequest({ action: 'type', text: '' }), /desktop_type_invalid/);
assert.throws(() => validateRequest({ action: 'open' }), /desktop_open_invalid/);
assert.throws(() => validateRequest({ action: 'focus' }), /desktop_focus_invalid/);
assert.throws(() => validateRequest({ action: 'keypress' }), /desktop_keypress_invalid/);
assert.throws(() => validateRequest({ action: 'hotkey', keys: ['CTRL'] }), /desktop_hotkey_invalid/);
assert.throws(() => validateRequest({ action: 'scroll' }), /desktop_scroll_invalid/);
assert.throws(() => validateRequest({ action: 'wait', ms: 60001 }), /desktop_wait_invalid/);

assert.ok(VERSION.startsWith('aria-windows-desktop-v1.8'));
assert.equal(ACTIONS.has('screenshot'), true);
assert.equal(ACTIONS.has('double_click'), true);
assert.equal(ACTIONS.has('move'), true);
assert.equal(ACTIONS.has('drag'), true);
assert.equal(ACTIONS.has('hotkey'), true);
assert.equal(ACTIONS.has('wait'), true);

const adapterSrc = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'windows-desktop-adapter.js'), 'utf8');
assert.match(adapterSrc, /-STA/);
assert.match(adapterSrc, /BitBlt/);
assert.match(adapterSrc, /SetProcessDPIAware/);
assert.match(adapterSrc, /FromHbitmap/);
assert.doesNotMatch(adapterSrc, /New-Object System\.Drawing\.Bitmap -ArgumentList @/);
assert.equal(typeof require('../computer-use/windows-desktop-adapter').executeWindowsDesktop, 'function');

const runnerSrc = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'windows-desktop-runner.ps1'), 'utf8');
assert.match(runnerSrc, /double_click/);
assert.match(runnerSrc, /Send-Vk/);
assert.match(runnerSrc, /'hotkey'/);
assert.match(runnerSrc, /'drag'/);

console.log('WINDOWS COMPUTER USE CONTRACT: PASS');
