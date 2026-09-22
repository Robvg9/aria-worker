const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/MainActivity.kt', 'utf8');
const html = fs.readFileSync('pwa/index.html', 'utf8');
const main = fs.readFileSync('pwa/src/main.tsx', 'utf8');

const mount = activity.indexOf('setContentView(scroll)');
const init = activity.indexOf('store = LocalMissionStore(applicationContext)');
assert.ok(mount >= 0, 'Android UI must mount a visible content view');
assert.ok(init > mount, 'Android mission runtime must initialize after UI mount');
assert.match(activity, /catch \(error: Throwable\) \{\s*showStartupFailure\(error\)/, 'Android startup must surface initialization failures');
assert.match(activity, /if \(::runner\.isInitialized\)/, 'Android onResume must tolerate startup failure');

assert.match(html, /id='aria-boot'/, 'PWA must include a visible boot surface');
assert.match(html, /ariaMounted/, 'PWA must expose mounted state');
assert.match(html, /RECARGAR/, 'PWA boot failure must offer recovery');
assert.match(main, /BootErrorBoundary/, 'PWA must catch React render errors');
assert.match(main, /__ariaBootReady/, 'PWA must dismiss the boot surface after mounting');

console.log('ARIA BLANK-SCREEN STARTUP RESILIENCE: PASS');
