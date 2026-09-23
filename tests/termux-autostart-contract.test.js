'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const supervisor = fs.readFileSync(path.join(__dirname, '../agents/termux/start-agent.sh'), 'utf8');
const boot = fs.readFileSync(path.join(__dirname, '../agents/termux/boot/start-aria-agent'), 'utf8');
const installer = fs.readFileSync(path.join(__dirname, '../agents/termux/install-autostart.sh'), 'utf8');
const docs = fs.readFileSync(path.join(__dirname, '../agents/termux/README.md'), 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '../agents/termux/aria-agent.js'), 'utf8');

assert.ok(supervisor.startsWith('#!/data/data/com.termux/files/usr/bin/bash'));
assert.ok(supervisor.includes('ARIA_DEVICE_GATEWAY_URL'));
assert.ok(supervisor.includes('ARIA_DEVICE_TOKEN'));
assert.ok(supervisor.includes('ARIA_DEVICE_ID'));
assert.ok(supervisor.includes('termux-wake-lock'));
assert.ok(supervisor.includes('git -C "$AGENT_DIR" pull --ff-only origin main'));
assert.ok(supervisor.includes('node "$AGENT_SCRIPT"'));
assert.ok(supervisor.includes('LOCK_DIR="${ARIA_AGENT_LOCK_DIR:-$HOME/.aria-agent.lock}"'));
assert.equal((supervisor.match(/"\$\$"/g)||[]).length, 3, 'supervisor must persist and compare its own PID for the lock');
assert.ok(!supervisor.includes('printf \'%s\\n\' "$"'));
assert.ok(!supervisor.includes('= "$" ]'));

assert.ok(!supervisor.includes('ARIA_DEVICE_TOKEN='));
assert.ok(boot.includes('$HOME/aria-agent/agents/termux/start-agent.sh'));
assert.ok(installer.startsWith('#!/data/data/com.termux/files/usr/bin/bash'));
assert.ok(installer.includes('mkdir -p "$BOOT_DIR"'));
assert.ok(installer.includes('cp "$BOOT_SRC" "$BOOT_DST"'));
assert.ok(installer.includes('rm -f "$HOME/.aria-agent.stop"'));
assert.ok(!installer.includes('nohup'), 'installer must not depend on nohup for Termux background lifecycle');
assert.ok(installer.includes('. "$AGENT_DIR/agents/termux/start-agent.sh"'));
assert.ok(installer.includes('background subshell'));
assert.ok(installer.includes('chmod 700 "$AGENT_DIR/agents/termux/start-agent.sh" "$AGENT_DIR/agents/termux/boot/start-aria-agent"'));
assert.ok(boot.includes('. "$SUPERVISOR"'));
assert.ok(!boot.includes('exec bash "$SUPERVISOR"'));
assert.ok(installer.includes('kill_descendants'));
assert.ok(installer.includes('refusing to replace unrelated locked process'));
assert.ok(installer.includes('replacing existing supervisor'));
assert.ok(installer.includes('supervisor.log'));
assert.ok(!installer.includes('ARIA_DEVICE_TOKEN='));
assert.ok(docs.includes('install-autostart.sh'));
assert.ok(docs.includes('Android boot'));
assert.ok(agent.includes("timeoutMs:8_000"));
assert.ok(agent.includes('job_claim_watchdog_timeout'));
assert.ok(agent.includes('Promise.race'));

console.log('termux autostart contract tests passed');
