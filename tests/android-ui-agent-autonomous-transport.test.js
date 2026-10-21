'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const root = require('node:path').join(__dirname, '..');
const receiver = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/CommandReceiver.kt'), 'utf8');
const service = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/AriaAccessibilityService.kt'), 'utf8');
const agent = fs.readFileSync(require('node:path').join(root, 'agents/termux/aria-agent.js'), 'utf8');
const transport = fs.readFileSync(require('node:path').join(root, 'computer-use/android-accessibility-v1.js'), 'utf8');
const ipc = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/LocalIpcServer.kt'), 'utf8');
const ipcAuth = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/IpcAuth.kt'), 'utf8');
const serviceIpc = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/AriaAccessibilityService.kt'), 'utf8');
const gateway = fs.readFileSync(require('node:path').join(root, 'supabase/functions/aria-device-gateway/index.ts'), 'utf8');

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
assert.ok(agent.includes('android-accessibility-v1'), 'Termux must use Accessibility executor');
assert.ok(agent.includes('heartbeatTimer.unref?.()'), 'heartbeat must not keep a stopped worker alive');
assert.ok(agent.includes("log('AGENT LOOP EXIT — supervisor will restart process')"), 'worker loop exit must hand control back to supervisor');
assert.ok(agent.includes("process.on('SIGTERM',()=>requestStop('SIGTERM'))"), 'SIGTERM must trigger controlled supervisor restart');
assert.ok(transport.includes('http://127.0.0.1:45874/execute'), 'executor must use loopback IPC');
assert.ok(transport.includes('authorization'), 'executor must authenticate loopback IPC');
assert.ok(!transport.includes('/system/bin/am broadcast'), 'legacy broadcast transport must not be used');
assert.ok(ipc.includes('127.0.0.1'), 'local IPC server must bind loopback');
assert.ok(ipcAuth.includes('const val PATH = "/execute"'), 'IPC auth contract must expose execute endpoint');
const gradle = fs.readFileSync(require('node:path').join(root, 'android-ui-agent/app/build.gradle.kts'), 'utf8');
assert.ok(gradle.includes('versionCode = 28'), 'APK version code must advance for checked-state serialization');
assert.ok(gradle.includes('versionName = "1.1.22"'), 'APK version name must advance for checked-state serialization');
assert.ok(gradle.includes('ARIA_BUILD_ID'), 'APK must embed exact build identity');
assert.ok(ipc.includes('buildId') || ipc.includes('ARIA_BUILD_ID'), 'IPC health must expose exact APK build identity');
assert.ok(transport.includes('build_id'), 'Termux health metadata must carry exact APK build identity');
assert.ok(agent.includes('build_id'), 'device heartbeat must persist exact APK build identity');
assert.ok(serviceIpc.includes('LocalIpcServer(this).also { it.start() }'), 'AccessibilityService must start local IPC');
assert.ok(serviceIpc.includes('localIpcServer?.stop()'), 'AccessibilityService must stop local IPC');
assert.ok(serviceIpc.includes('refreshAccessibilityRoot'), 'Accessibility evidence capture must refresh the browser root before serialization');
assert.ok(serviceIpc.includes('root.refresh()'), 'Accessibility evidence capture must call AccessibilityNodeInfo.refresh()');
assert.ok(serviceIpc.includes('.put("checkable", node.isCheckable)'), 'Accessibility snapshots must preserve checkable state');
assert.ok(serviceIpc.includes('.put("checked", node.isChecked)'), 'Accessibility snapshots must preserve checked state');
assert.ok(service.includes('val browserTarget = targetPackage?.let { approvedBrowsers.contains(it) } == true'), 'browser clicks must use the bounded gesture path first');
assert.ok(service.includes('gestureClick(node) || node.performAction(AccessibilityNodeInfo.ACTION_CLICK)'), 'browser click fallback must remain available');
assert.ok(!service.includes('PLACEHOLDER_SERVICE'), 'placeholder accessibility service must not remain active');
assert.ok(gateway.includes('executionJobGatewayCall'), 'gateway must use the governed database job transport');
assert.ok(gateway.includes('SUPABASE_DB_URL'), 'gateway must use the configured Supabase database transport');
assert.ok(gateway.includes('postgres(dbUrl'), 'gateway must use the governed Postgres client transport');
assert.ok(gateway.includes('claim_execution_job_gateway'), 'gateway claim must call the governed claim routine');
assert.ok(agent.includes("timeoutMs:8_000"), 'agent claim request must have a bounded transport timeout');

// CI revalidation marker: exercise Android RWHT workflow on the current main toolchain.\n// Physical Android UI responses are sanitized into durable metadata instead of being discarded.
assert.ok(gateway.includes('function summarizeAndroidUiEvidence'), 'Android UI evidence summary must be persisted by the result gateway');
assert.ok(gateway.includes('android_ui_summary'), 'successful Android UI jobs must retain a compact evidence summary');
assert.ok(gateway.includes('ui_evidence_hash'), 'the summary must preserve the actual post-action UI evidence hash');
assert.ok(gateway.includes('battlecruiser_marker_visible'), 'the summary must expose an app-specific visible marker without storing page text');
assert.ok(gateway.includes('node_count'), 'the summary must record the observed accessibility tree size');
assert.ok(gateway.includes('preference_switches'), 'the summary must persist allowlisted preference switch state');
assert.ok(gateway.includes("checkable:typeof node?.checkable==='boolean'?node.checkable:null"), 'the summary must preserve unknown checkable state as null');
assert.ok(gateway.includes("checked:typeof node?.checked==='boolean'?node.checked:null"), 'the summary must preserve unknown checked state as null');
for (const label of ['Actualización automática','Sincronización automática','Sincronizar al abrir app','Sincronizar solo en Wi-Fi','Notificaciones','Modo compacto']) {
  assert.ok(gateway.includes(label), 'missing allowlisted preference-state label: ' + label);
}
assert.ok(gateway.includes('cleanMetadata.android_ui_summary=androidUiSummary'), 'the compact summary must be included in the persisted job result metadata');
assert.ok(gateway.includes('baseMetadata.autonomous_test!==true'), 'Android UI summary must not overwrite the autonomous-runner trace summary');

// Real Postgres stored execution_jobs.result as a JSONB string scalar when the serialized JSON
// parameter was cast directly to jsonb. Force text -> jsonb so operators can query metadata directly.
assert.ok(gateway.includes('${JSON.stringify(args.result||{})}::text::jsonb'), 'result serialization must parse the JSON text into a JSONB object');
assert.ok(!gateway.includes('${JSON.stringify(args.result||{})}::jsonb'), 'result serialization must not double-encode the payload as a JSONB string scalar');

console.log('ANDROID UI AGENT AUTONOMOUS TRANSPORT: PASS');
