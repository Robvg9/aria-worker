'use strict';

const assert = require('assert');
const fs = require('fs');

const supervisor = fs.readFileSync(require('path').join(__dirname, '../agents/termux/start-agent.sh'), 'utf8');
const boot = fs.readFileSync(require('path').join(__dirname, '../agents/termux/boot/start-aria-agent'), 'utf8');
const docs = fs.readFileSync(require('path').join(__dirname, '../agents/termux/README.md'), 'utf8');

assert.ok(supervisor.startsWith('#!/data/data/com.termux/files/usr/bin/bash'));
assert.ok(supervisor.includes('ARIA_DEVICE_GATEWAY_URL'));
assert.ok(supervisor.includes('ARIA_DEVICE_TOKEN'));
assert.ok(supervisor.includes('ARIA_DEVICE_ID'));
assert.ok(supervisor.includes('termux-wake-lock'));
assert.ok(supervisor.includes('git -C "$AGENT_DIR" pull --ff-only origin main'));
assert.ok(supervisor.includes('node "$AGENT_SCRIPT"'));
assert.ok(!supervisor.includes('ARIA_DEVICE_TOKEN='));
assert.ok(boot.includes('boot') || boot.includes('termux-wake-lock'));
assert.ok(boot.includes('$HOME/aria-agent/agents/termux/start-agent.sh'));
assert.ok(docs.includes('The device token is never stored in this repository.'));

console.log('termux autostart contract tests passed');
