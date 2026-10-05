'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'pwa', 'src', 'App.tsx'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'rwht', 'pc-browser', 'rwht-persistence-recovery-e2e.mjs'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'persistence-recovery-rwht-authenticated.yml'), 'utf8');

for (const fragment of [
  "SESSION_KEY = 'aria_session_v2'",
  "CACHE_PREFIX = 'aria-runtime-cache-v3'",
  "function readCached",
  "function writeCached",
  "CHAT_HISTORY_KEY_PREFIX = 'aria-chat-history-v1'",
  "function readChatHistory",
  "function writeChatHistory",
  "refreshSessionDirect",
  "refreshSessionProxy",
  "localStorage.setItem(SESSION_KEY",
  "clearCache",
  "const sessionSnapshot = localStorage.getItem(SESSION_KEY)",
  "useLiveSync",
  "selectLiveMission",
  "clientMessageId",
  "d?.processing"
]) {
  assert.ok(app.includes(fragment), fragment);
}

for (const fragment of [
  'aria-persistence-recovery-rwht-e2e-v1.0.1',
  'aria_session_v2',
  'aria-runtime-cache-v3',
  'aria-chat-history-v1:',
  'if (!key.startsWith(chatPrefix)) continue;',
  'session_refresh_not_repersisted',
  'session_reload_persistence_missing',
  'chat_server_persistence_missing',
  'chat_reload_persistence_verified',
  'dashboard_recovery_from_api_failure_missing',
  'live_sync_recovered',
  'Núcleo conectado',
  'failed_responses',
  'page_errors',
  'console_errors'
]) {
  assert.ok(runner.includes(fragment), fragment);
}

for (const fragment of [
  'ARIA Persistence + Recovery Browser RWHT Authenticated',
  'RWHT_EMAIL: \${{ secrets.RWHT_EMAIL }}',
  'RWHT_PASSWORD: \${{ secrets.RWHT_PASSWORD }}',
  'RWHT_STORAGE_STATE_B64: \${{ secrets.RWHT_STORAGE_STATE_B64 }}',
  'Execute authenticated Persistence + Recovery E2E',
  'aria-persistence-recovery-rwht-evidence',
  'pwa/src/App.tsx',
  'npx playwright install chromium'
]) {
  assert.ok(workflow.includes(fragment), fragment);
}

for (const fragment of [
  "clientMessageId",
  "conversation_post_requests"
]) {
  assert.ok(runner.includes(fragment), fragment);
}

const api = fs.readFileSync(path.join(root, 'supabase', 'functions', 'aria-app-api-v3', 'index.ts'), 'utf8');
for (const fragment of [
  "clientMessageId:string|null=null",
  "const jobSeed=String(clientMessageId||crypto.randomUUID()).trim();",
  "waitForLocal:boolean=true",
  'EdgeRuntime.waitUntil(',
  'visualState:"processing"',
  'completeLocalChatInBackground'
]) {
  assert.ok(api.includes(fragment), fragment);
}

assert.doesNotMatch(runner, /console\.(log|error)\([^\n]*(password|refreshToken|accessToken)/i);
assert.doesNotMatch(runner, /key\.startsWith\(chatPrefix \+ ':'\)/);

console.log('PWA PERSISTENCE + RECOVERY CONTRACT: PASS');
