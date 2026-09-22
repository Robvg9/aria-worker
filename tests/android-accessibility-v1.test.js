'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PACKAGE,
  LOCAL_IPC_URL,
  LOCAL_IPC_HEALTH_URL,
  probeLocalIpcHealth,
  executeAndroidAccessibilityJob
} = require('../computer-use/android-accessibility-v1');

assert.equal(PACKAGE, 'com.robvg9.ariauiagent.debug');
assert.equal(LOCAL_IPC_URL, 'http://127.0.0.1:45874/execute');
assert.equal(LOCAL_IPC_HEALTH_URL, 'http://127.0.0.1:45874/health');

const transport = fs.readFileSync(path.join(__dirname, '..', 'computer-use', 'android-accessibility-v1.js'), 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '..', 'agents', 'termux', 'aria-agent.js'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const receiver = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'java', 'com', 'robvg9', 'ariauiagent', 'CommandReceiver.kt'), 'utf8');
const ipc = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'java', 'com', 'robvg9', 'ariauiagent', 'LocalIpcServer.kt'), 'utf8');
const ipcAuth = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'src', 'main', 'java', 'com', 'robvg9', 'ariauiagent', 'IpcAuth.kt'), 'utf8');
const gradle = fs.readFileSync(path.join(__dirname, '..', 'android-ui-agent', 'app', 'build.gradle.kts'), 'utf8');

assert.ok(transport.includes('http://127.0.0.1:45874/execute'));
assert.ok(transport.includes('http://127.0.0.1:45874/health'));
assert.ok(transport.includes('android-local-http'));
assert.ok(transport.includes('probeLocalIpcHealth'));
assert.ok(transport.includes('attempt <= 3'));
assert.ok(agent.includes('probeLocalIpcHealth'));
assert.ok(agent.includes("if (androidUiHealth.ok) capabilities.push('computer.use.android')"));
assert.ok(manifest.includes('AriaAccessibilityService'));
assert.ok(manifest.includes('<queries>'));
assert.ok(manifest.includes('<package android:name="com.termux" />'));
assert.ok(!manifest.includes('android:permission="android.permission.DUMP"'));
assert.ok(receiver.includes('setResultData'));
assert.ok(receiver.includes('getSentFromUid'));
assert.ok(receiver.includes('com.termux'));
assert.ok(receiver.includes('getApplicationInfo'));
assert.ok(receiver.includes('IPC_TOKEN'));
assert.ok(!receiver.includes('Process.SHELL_UID'));
assert.ok(gradle.includes('applicationIdSuffix = ".debug"'));
assert.ok(gradle.includes('versionCode = 22'));
assert.ok(gradle.includes('versionName = "1.1.16"'));
assert.ok(ipcAuth.includes('HEALTH_PATH = "/health"'));
assert.ok(ipc.includes('server.bind'));
assert.ok(ipc.includes('fun isHealthy'));
assert.ok(ipc.includes('IpcAuth.HEALTH_PATH'));
assert.ok(ipc.indexOf('server.bind') < ipc.indexOf('acceptExecutor?.execute'));
assert.ok(!transport.includes('127.0.0.1:43817'));
assert.ok(!agent.includes('android-browser-bridge-v1'));
assert.ok(manifest.includes('android.permission.INTERNET'));
assert.ok(!transport.includes('/system/bin/am broadcast'));
assert.ok(!manifest.includes('ARIA Browser Bridge'));

(async () => {
  const originalFetch = global.fetch;
  try {
    let calls = 0;
    global.fetch = async (url, options) => {
      calls += 1;
      assert.equal(url, LOCAL_IPC_HEALTH_URL);
      assert.equal(options.method, 'GET');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, service: 'aria-accessibility', port: 45874 })
      };
    };
    const health = await probeLocalIpcHealth({ timeoutMs: 1000 });
    assert.equal(health.ok, true);
    assert.equal(health.payload.port, 45874);
    assert.equal(calls, 1);

    calls = 0;
    global.fetch = async (url) => {
      calls += 1;
      assert.equal(url, LOCAL_IPC_URL);
      if (calls === 1) throw new TypeError('fetch failed');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, evidence_hash: 'retry-pass' })
      };
    };
    const retried = await executeAndroidAccessibilityJob({
      command: JSON.stringify({ operation: 'observe' }),
      timeoutMs: 3000
    });
    assert.equal(retried.status, 'succeeded');
    assert.equal(retried.payload.evidence_hash, 'retry-pass');
    assert.equal(calls, 2);

    console.log('android-accessibility-v1 PASS');
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
