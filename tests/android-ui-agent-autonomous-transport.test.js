'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const root = require('node:path').join(__dirname, '..');
const receiver = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/CommandReceiver.kt'), 'utf8');
const service = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/AriaAccessibilityService.kt'), 'utf8');
const agent = fs.readFileSync(require('node:path').join(root, 'agents/termux/aria-agent.js'), 'utf8');

for (const marker of ['TERMUX_PACKAGE', 'getApplicationInfo(TERMUX_PACKAGE', 'IPC_TOKEN', 'tokenValid', 'AriaAccessibilityService.instance', 'service.handle(payload)']) {
  assert.ok(receiver.includes(marker), 'missing receiver transport marker: ' + marker);
}
for (const marker of ['allow_any_app', 'target_package', 'resolveAnyApplicationRootWithDiag', 'launch_app', 'navigate']) {
  assert.ok(service.includes(marker), 'missing service autonomy marker: ' + marker);
}
for (const marker of ['android-autonomous-runner-v1', 'mode === \'autonomous_test\'', 'executeAutonomousAndroidMission']) {
  assert.ok(agent.includes(marker), 'missing Termux autonomy marker: ' + marker);
}
assert.ok(!receiver.includes('broadcast_path_disabled'), 'legacy disabled receiver must not remain active');
assert.ok(receiver.includes('getSentFromUid()'), 'UID sender identity should still be checked when Android exposes it');
assert.ok(receiver.includes('ipc_token'), 'explicit IPC token fallback must remain');
assert.ok(agent.includes('ipc_token'), 'Termux sender must authenticate IPC fallback');
assert.ok(!service.includes('PLACEHOLDER_SERVICE'), 'placeholder accessibility service must not remain active');

console.log('ANDROID UI AGENT AUTONOMOUS TRANSPORT: PASS');
