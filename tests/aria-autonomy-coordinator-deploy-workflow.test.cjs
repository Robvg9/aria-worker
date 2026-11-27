'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync(
  require('node:path').join(__dirname, '..', '.github', 'workflows', 'aria-autonomy-coordinator-deploy.yml'),
  'utf8'
);

assert.match(workflow, /confirm_public_deploy:[\s\S]{0,500}default: false/);
assert.match(workflow, /send_telegram_test:[\s\S]{0,500}default: false/);
assert.match(workflow, /if: inputs\.confirm_public_deploy == true/);
assert.match(workflow, /if: inputs\.send_telegram_test == true/);

assert.ok(workflow.includes('r"\\d+:[A-Za-z0-9_-]{20,}"'), 'bot token format check must match a numeric bot id and token');
assert.ok(workflow.includes('r"-?\\d{1,25}"'), 'chat id format check must accept numeric Telegram chat ids');


for (const secret of [
  'secrets.ARIA_AUTONOMY_TELEGRAM_BOT_TOKEN',
  'secrets.ARIA_AUTONOMY_TELEGRAM_CHAT_ID'
]) {
  assert.ok(workflow.includes(secret), 'deployment workflow must support ' + secret);
}

for (const contract of [
  'OPTIONAL_TELEGRAM_SECRET_PAIR_COMPLETE',
  'OPTIONAL_TELEGRAM_BOT_TOKEN_FORMAT',
  'OPTIONAL_TELEGRAM_CHAT_ID_FORMAT',
  'TELEGRAM_TEST_REQUIRES_DIRECT_BOT_CREDENTIALS',
  'ARIA_TELEGRAM_BOT_TOKEN',
  'ARIA_TELEGRAM_CHAT_ID',
  'wrangler deploy --config wrangler.aria-autonomy.toml --secrets-file .aria-autonomy-secrets.json'
]) {
  assert.ok(workflow.includes(contract), 'deployment workflow missing contract: ' + contract);
}

assert.match(workflow, /for key in \([\s\S]{0,180}"ARIA_TELEGRAM_BOT_TOKEN", "ARIA_TELEGRAM_CHAT_ID"\)/);
console.log('ARIA AUTONOMY COORDINATOR DIRECT TELEGRAM SECRET WIRING: PASS');
console.log('ARIA AUTONOMY COORDINATOR TELEGRAM HUMAN GATE: PASS');
