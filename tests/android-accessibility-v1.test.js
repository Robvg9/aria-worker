'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE, RECEIVER, ACTION, parseBroadcastData } = require('../computer-use/android-accessibility-v1');

assert.equal(PACKAGE, 'com.robvg9.ariauiagent.debug');
assert.equal(RECEIVER, '.CommandReceiver');
assert.equal(ACTION, 'com.robvg9.ariauiagent.ACTION_EXECUTE');

const encoded = Buffer.from(JSON.stringify({ ok: true, evidence_hash: 'abc123', ui: { root: { id: '0' } } }), 'utf8').toString('base64');
const parsed = parseBroadcastData('Broadcast completed: result=0, data="' + encoded + '"');
assert.equal(parsed.status, 'succeeded');
assert.equal(parsed.payload.ok, true);
assert.equal(parsed.payload.evidence_hash, 'abc123');

const missing = parseBroadcastData('Broadcast completed: result=1');
assert.equal(missing.status, 'failed');
assert.equal(missing.reason, 'broadcast_result_missing');

const invalid = parseBroadcastData('Broadcast completed: result=0, data="not-base64-json"');
assert.equal(invalid.status, 'failed');
assert.equal(invalid.reason, 'broadcast_result_invalid');

const transport = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'android-accessibility-v1.js'), 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '..', 'agents', 'termux', 'aria-agent.js'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const receiver = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'java', 'com', 'robvg9', 'ariauiagent', 'CommandReceiver.kt'), 'utf8');
const gradle = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'build.gradle.kts'), 'utf8');

assert.ok(transport.includes('/system/bin/am broadcast'));
assert.ok(transport.includes("PATH: '/system/bin:/system/xbin:'"));
assert.ok(transport.includes("const PACKAGE = 'com.robvg9.ariauiagent.debug'"));
assert.ok(agent.includes('android-accessibility-v1'));
assert.ok(manifest.includes('AriaAccessibilityService'));
assert.ok(!manifest.includes('android:permission="android.permission.DUMP"'));
assert.ok(receiver.includes('setResultData'));
assert.ok(receiver.includes('getSentFromUid'));
assert.ok(receiver.includes('com.termux'));
assert.ok(receiver.includes('getApplicationInfo'));
assert.ok(!receiver.includes('Process.SHELL_UID'));
assert.ok(gradle.includes('applicationIdSuffix = ".debug"'));
assert.ok(gradle.includes('versionCode = 4'));
assert.ok(gradle.includes('versionName = "1.0.3"'));
assert.ok(!transport.includes('127.0.0.1:43817'));
assert.ok(!agent.includes('android-browser-bridge-v1'));
assert.ok(!manifest.includes('ARIA Browser Bridge'));

console.log('android-accessibility-v1 PASS');
