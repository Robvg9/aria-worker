'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const DEVICE_ID = 'android-termux-a1ebcfc7-9287-4603-a0f9-c519d12fd092';
const checks = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  assert.ok(ok, detail || name);
}

const accessibility = read('computer-use/android-accessibility-v1.js');
const rwht = read('computer-use/android-rwht-v1.js');
const adapter = read('computer-use/android-browser-bridge-adapter-v1.js');
const agent = read('agents/termux/aria-agent.js');
const gradle = read('android-ui-agent/app/build.gradle.kts');
const manifest = read('android-ui-agent/app/src/main/AndroidManifest.xml');

check('canonical-device', rwht.includes(DEVICE_ID), DEVICE_ID);
check('ipc-port', accessibility.includes('127.0.0.1:45874/execute'));
check('ipc-health', accessibility.includes('127.0.0.1:45874/health'));
check('ipc-v2', accessibility.includes('aria-android-ui-agent-ipc-v2'));
check('bounded-recovery', accessibility.includes('attempt <= 3'));
check('process-recovery', accessibility.includes('recoverAndroidUiAgentProcess'));
check('heartbeat-computer-use', agent.includes("capabilities.push('computer.use.android')"));
check('apk-debug', gradle.includes('applicationIdSuffix = ".debug"'));
check('apk-version-code', gradle.includes('versionCode = 27'));
check('apk-version-name', gradle.includes('versionName = "1.1.21"'));
check('accessibility-service', manifest.includes('AriaAccessibilityService'));
check('bridge-native', adapter.includes('computer.use.android'));
check('no-legacy-43817', !accessibility.includes('127.0.0.1:43817'));

console.log('PHASE6_ANDROID_PREFLIGHT=PASS');
console.log(JSON.stringify({ phase: '6/9', device_id: DEVICE_ID, checks }, null, 2));
