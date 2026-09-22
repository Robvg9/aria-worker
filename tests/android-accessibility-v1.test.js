'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE, LOCAL_IPC_URL, executeAndroidAccessibilityJob } = require('../computer-use/android-accessibility-v1');

assert.equal(PACKAGE, 'com.robvg9.ariauiagent.debug');
assert.equal(LOCAL_IPC_URL, 'http://127.0.0.1:45874/execute');

const transport = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'android-accessibility-v1.js'), 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '..', 'agents', 'termux', 'aria-agent.js'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const receiver = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'java', 'com', 'robvg9', 'ariauiagent', 'CommandReceiver.kt'), 'utf8');
const ipc = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'java', 'com', 'robvg9', 'ariauiagent', 'LocalIpcServer.kt'), 'utf8');
const gradle = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'build.gradle.kts'), 'utf8');

assert.ok(transport.includes('http://127.0.0.1:45874/execute'));
assert.ok(transport.includes('android-local-http'));
assert.ok(transport.includes("const PACKAGE = 'com.robvg9.ariauiagent.debug'"));
assert.ok(agent.includes('android-accessibility-v1'));
assert.ok(manifest.includes('AriaAccessibilityService'));
assert.ok(manifest.includes('<queries>'));
assert.ok(manifest.includes('<package android:name="com.termux" />'));
assert.ok(!manifest.includes('android:permission="android.permission.DUMP"'));
assert.ok(receiver.includes('setResultData'));
assert.ok(receiver.includes('getSentFromUid'));
assert.ok(receiver.includes('com.termux'));
assert.ok(receiver.includes('getApplicationInfo'));
assert.ok(receiver.includes('IPC_TOKEN'));
assert.ok(transport.includes('authorization'));
assert.ok(!receiver.includes('Process.SHELL_UID'));
assert.ok(gradle.includes('applicationIdSuffix = ".debug"'));
assert.ok(gradle.includes('versionCode = 21'));
assert.ok(gradle.includes('versionName = "1.1.15"'));
assert.ok(!transport.includes('127.0.0.1:43817'));
assert.ok(!agent.includes('android-browser-bridge-v1'));
assert.ok(manifest.includes('android.permission.INTERNET'));
assert.ok(ipc.includes('127.0.0.1'));
assert.ok(ipc.includes('/execute'));
assert.ok(!transport.includes('/system/bin/am broadcast'));
assert.ok(!manifest.includes('ARIA Browser Bridge'));

console.log('android-accessibility-v1 PASS');
